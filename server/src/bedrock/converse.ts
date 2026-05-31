import {
  ConverseCommand,
  ConverseStreamCommand,
  type Message as BedrockMessage,
  type SystemContentBlock,
  type Tool,
  type ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import type { ContentBlock, SSEEvent } from "@chat/shared";
import { getRuntimeClient } from "./client.js";
import { toBedrockMessages } from "./convert.js";
import {
  SEARCH_TOOL_NAME,
  runSearchHistory,
  searchHistoryTool,
} from "./tools/searchHistory.js";
import {
  GENERATE_IMAGE_TOOL_NAME,
  generateImageTool,
  runGenerateImage,
} from "./tools/generateImage.js";
import {
  WEB_SEARCH_TOOL_NAME,
  runWebSearch,
  webSearchTool,
} from "./tools/webSearch.js";
import {
  addMessage,
  getContextMessages,
  linkAttachmentsToMessage,
} from "../db/repo.js";
import { modelSupportsTools } from "./models.js";
import type { Message } from "@chat/shared";

const MAX_TOOL_ROUNDS = 5;

// In-flight streams by chatId, so a Stop request can abort the Bedrock call.
// Aborting cancels the underlying HTTP stream (stopping token billing); the
// partial assistant text generated so far is then persisted by streamChat.
const inflight = new Map<number, AbortController>();

export function stopChat(chatId: number): boolean {
  const ac = inflight.get(chatId);
  if (!ac) return false;
  ac.abort();
  return true;
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

// Keep the last `maxMessages`, then drop leading messages that would make the
// conversation start invalidly (must begin with a real user message, never an
// orphaned toolResult or a dangling assistant turn).
function trimHistory(messages: Message[], maxMessages: number): Message[] {
  let slice = messages.slice(-Math.max(maxMessages, 2));
  while (
    slice.length > 0 &&
    (slice[0].role !== "user" ||
      slice[0].blocks.every((b) => b.type === "toolResult"))
  ) {
    slice = slice.slice(1);
  }
  return slice;
}

// Non-tool models (e.g. DeepSeek) reject not just a toolConfig but ANY tool
// content in the request — a toolUse/toolResult block left in the history (from
// when the chat used a tool-capable model) triggers the same "doesn't support
// tool use in streaming mode" error. Drop those blocks, then drop any message
// left with no content so the conversation stays valid.
function stripToolBlocks(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    const blocks = m.blocks.filter(
      (b) => b.type !== "toolUse" && b.type !== "toolResult"
    );
    if (blocks.length > 0) out.push({ ...m, blocks });
  }
  return out;
}

// Accumulates streamed content blocks keyed by their contentBlockIndex.
interface AccBlock {
  type: "text" | "toolUse";
  text: string;
  toolUseId?: string;
  name?: string;
  inputJson: string; // partial JSON fragments, parsed at block stop
}

export interface StreamResult {
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

// Drives a streaming chat turn, including the tool-use loop. Persists every
// assistant turn and tool-result turn to the DB. Emits SSE events via `emit`.
export async function streamChat(opts: {
  chatId: number;
  projectId: number | null;
  modelId: string;
  systemText: string;
  temperature: number;
  maxTokens: number;
  maxMessages: number;
  includeSearchTool: boolean;
  includeImageTool: boolean;
  includeWebSearchTool: boolean;
  includeCaching: boolean;
  emit: (e: SSEEvent) => void;
}): Promise<StreamResult> {
  const client = getRuntimeClient();

  // A cachePoint marks the end of a cacheable prefix. We place them after the
  // system prompt, after the tools, and at the end of the conversation so that
  // repeated prefixes are served from Bedrock's prompt cache. Only enabled for
  // models that support it (see ModelInfo.supportsCaching).
  const cachePoint = { cachePoint: { type: "default" as const } };

  const system: SystemContentBlock[] | undefined = opts.systemText
    ? opts.includeCaching
      ? [{ text: opts.systemText }, cachePoint]
      : [{ text: opts.systemText }]
    : undefined;

  // Only tool-capable models (Anthropic Claude, Amazon Nova) accept a toolConfig.
  // Sending tools to any other model (e.g. DeepSeek) makes ConverseStream throw
  // "This model doesn't support tool use in streaming mode", so gate on the model
  // here even if the caller asked for tools.
  const supportsTools = modelSupportsTools(opts.modelId);
  const tools: Tool[] = [];
  if (supportsTools && opts.includeSearchTool) tools.push(searchHistoryTool);
  if (supportsTools && opts.includeImageTool) tools.push(generateImageTool);
  if (supportsTools && opts.includeWebSearchTool) tools.push(webSearchTool);
  if (opts.includeCaching && tools.length > 0) tools.push(cachePoint as Tool);
  const toolConfig: ToolConfiguration | undefined =
    tools.length > 0 ? { tools } : undefined;

  // TEMP diagnostic: confirms whether a toolConfig is being sent for this model.
  // Remove once the "doesn't support tool use in streaming mode" issue is settled.
  console.error(
    `[streamChat] model=${opts.modelId} supportsTools=${supportsTools} ` +
      `toolCount=${tools.length} hasToolConfig=${!!toolConfig}`
  );

  // Seed the conversation from persisted history (already includes the new
  // user message the route saved before calling us), trimmed to context size.
  // For non-tool models, also strip any tool blocks left over from earlier turns
  // (see stripToolBlocks) before trimming, or Bedrock rejects the request.
  const rawHistory = getContextMessages(opts.chatId);
  const convo: BedrockMessage[] = toBedrockMessages(
    trimHistory(
      supportsTools ? rawHistory : stripToolBlocks(rawHistory),
      opts.maxMessages
    )
  );

  // Cache the conversation prefix too (everything through the latest user
  // message). On the next turn this prefix is reused. Appended once here; the
  // tool-use loop adds new messages after it, keeping us within the 4-point cap.
  if (opts.includeCaching && convo.length > 0) {
    const last = convo[convo.length - 1];
    last.content = [...(last.content ?? []), cachePoint];
  }

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let lastStopReason = "end_turn";

  // Register an abort controller for this chat so a Stop request can cancel the
  // Bedrock stream. Cleared in the finally below.
  const ac = new AbortController();
  inflight.set(opts.chatId, ac);
  try {
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const blocks = new Map<number, AccBlock>();
    let stopReason = "end_turn";
    let roundInput = 0;
    let roundOutput = 0;
    let roundCacheRead = 0;
    let roundCacheWrite = 0;
    let stopped = false;

    try {
      const res = await client.send(
        new ConverseStreamCommand({
          modelId: opts.modelId,
          messages: convo,
          system,
          toolConfig,
          inferenceConfig: {
            temperature: opts.temperature,
            maxTokens: opts.maxTokens,
          },
        }),
        { abortSignal: ac.signal }
      );

      for await (const chunk of res.stream ?? []) {
      if (chunk.messageStart) {
        opts.emit({ type: "start" });
      } else if (chunk.contentBlockStart) {
        const idx = chunk.contentBlockStart.contentBlockIndex ?? 0;
        const tu = chunk.contentBlockStart.start?.toolUse;
        if (tu) {
          blocks.set(idx, {
            type: "toolUse",
            text: "",
            toolUseId: tu.toolUseId,
            name: tu.name,
            inputJson: "",
          });
          opts.emit({
            type: "tool_call_start",
            toolUseId: tu.toolUseId ?? "",
            name: tu.name ?? "",
          });
        }
      } else if (chunk.contentBlockDelta) {
        const idx = chunk.contentBlockDelta.contentBlockIndex ?? 0;
        const delta = chunk.contentBlockDelta.delta;
        if (delta?.text) {
          const b =
            blocks.get(idx) ??
            ({ type: "text", text: "", inputJson: "" } as AccBlock);
          b.text += delta.text;
          blocks.set(idx, b);
          opts.emit({ type: "delta", text: delta.text });
        } else if (delta?.toolUse?.input !== undefined) {
          const b = blocks.get(idx);
          if (b) b.inputJson += delta.toolUse.input;
        }
      } else if (chunk.messageStop) {
        stopReason = chunk.messageStop.stopReason ?? "end_turn";
      } else if (chunk.metadata?.usage) {
        const u = chunk.metadata.usage;
        roundInput += u.inputTokens ?? 0;
        roundOutput += u.outputTokens ?? 0;
        roundCacheRead += u.cacheReadInputTokens ?? 0;
        roundCacheWrite += u.cacheWriteInputTokens ?? 0;
      }
      }
    } catch (err) {
      // A Stop request aborts the Bedrock stream; any other error propagates.
      if (!isAbortError(err)) throw err;
      stopped = true;
    }

    totalInput += roundInput;
    totalOutput += roundOutput;
    totalCacheRead += roundCacheRead;
    totalCacheWrite += roundCacheWrite;

    // Stopped by the user mid-stream: persist whatever assistant text was
    // generated so far (marked "stopped") and end the turn here.
    if (stopped) {
      lastStopReason = "stopped";
      const partial: ContentBlock[] = [...blocks.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, b]) => b)
        .filter((b) => b.type === "text" && b.text)
        .map((b) => ({ type: "text", text: b.text }) as ContentBlock);
      if (partial.length > 0) {
        const saved = addMessage({
          chatId: opts.chatId,
          role: "assistant",
          blocks: partial,
          modelId: opts.modelId,
          stopReason: "stopped",
          inputTokens: roundInput || null,
          outputTokens: roundOutput || null,
          cacheReadTokens: roundCacheRead || null,
          cacheWriteTokens: roundCacheWrite || null,
        });
        opts.emit({ type: "message_saved", message: saved });
      }
      break;
    }

    lastStopReason = stopReason;

    // Reconstruct the assistant message blocks in index order.
    const ordered = [...blocks.entries()].sort((a, b) => a[0] - b[0]);
    const assistantBlocks: ContentBlock[] = [];
    const toolCalls: { toolUseId: string; name: string; input: unknown }[] = [];

    for (const [, b] of ordered) {
      if (b.type === "text" && b.text) {
        assistantBlocks.push({ type: "text", text: b.text });
      } else if (b.type === "toolUse") {
        let input: unknown = {};
        try {
          input = b.inputJson ? JSON.parse(b.inputJson) : {};
        } catch {
          input = {};
        }
        assistantBlocks.push({
          type: "toolUse",
          toolUseId: b.toolUseId ?? "",
          name: b.name ?? "",
          input,
        });
        toolCalls.push({
          toolUseId: b.toolUseId ?? "",
          name: b.name ?? "",
          input,
        });
      }
    }

    // Persist the assistant turn.
    const savedAssistant = addMessage({
      chatId: opts.chatId,
      role: "assistant",
      blocks: assistantBlocks,
      modelId: opts.modelId,
      stopReason,
      inputTokens: roundInput,
      outputTokens: roundOutput,
      cacheReadTokens: roundCacheRead,
      cacheWriteTokens: roundCacheWrite,
    });
    opts.emit({ type: "message_saved", message: savedAssistant });
    convo.push({
      role: "assistant",
      content: toBedrockMessages([savedAssistant])[0]?.content ?? [],
    });

    if (stopReason !== "tool_use" || toolCalls.length === 0) {
      break;
    }

    // Run each requested tool and assemble a user toolResult turn.
    const resultBlocks: ContentBlock[] = [];
    const generatedAttachmentIds: number[] = [];
    for (const call of toolCalls) {
      if (call.name === SEARCH_TOOL_NAME) {
        const results = runSearchHistory(call.input);
        resultBlocks.push({
          type: "toolResult",
          toolUseId: call.toolUseId,
          status: "success",
          content: results,
        });
        opts.emit({
          type: "tool_result",
          toolUseId: call.toolUseId,
          name: call.name,
          resultCount: results.length,
        });
      } else if (call.name === GENERATE_IMAGE_TOOL_NAME) {
        const r = await runGenerateImage(call.input);
        if (r.ok) {
          resultBlocks.push({
            type: "toolResult",
            toolUseId: call.toolUseId,
            status: "success",
            content: [],
            images: [{ attachmentId: r.attachmentId, mime: r.mime, name: r.name }],
            summary: `Generated an image for: "${r.prompt}". It is now shown to the user.`,
          });
          generatedAttachmentIds.push(r.attachmentId);
          opts.emit({
            type: "tool_result",
            toolUseId: call.toolUseId,
            name: call.name,
            resultCount: 1,
          });
        } else {
          resultBlocks.push({
            type: "toolResult",
            toolUseId: call.toolUseId,
            status: "error",
            content: [],
            summary: r.error,
          });
          opts.emit({
            type: "tool_result",
            toolUseId: call.toolUseId,
            name: call.name,
            resultCount: 0,
          });
        }
      } else if (call.name === WEB_SEARCH_TOOL_NAME) {
        const r = await runWebSearch(call.input);
        if (r.ok) {
          resultBlocks.push({
            type: "toolResult",
            toolUseId: call.toolUseId,
            status: "success",
            content: [],
            webResults: r.results,
            answer: r.answer,
          });
          opts.emit({
            type: "tool_result",
            toolUseId: call.toolUseId,
            name: call.name,
            resultCount: r.results.length,
          });
        } else {
          resultBlocks.push({
            type: "toolResult",
            toolUseId: call.toolUseId,
            status: "error",
            content: [],
            summary: r.error,
          });
          opts.emit({
            type: "tool_result",
            toolUseId: call.toolUseId,
            name: call.name,
            resultCount: 0,
          });
        }
      } else {
        resultBlocks.push({
          type: "toolResult",
          toolUseId: call.toolUseId,
          status: "error",
          content: [],
        });
      }
    }

    const savedToolResult = addMessage({
      chatId: opts.chatId,
      role: "user",
      blocks: resultBlocks,
    });
    // Link generated images to their tool-result message so they aren't orphaned.
    if (generatedAttachmentIds.length > 0) {
      linkAttachmentsToMessage(generatedAttachmentIds, savedToolResult.id);
    }
    // Stream the tool-result message so generated images render immediately
    // (the client filters out result messages that carry no images).
    opts.emit({ type: "message_saved", message: savedToolResult });
    convo.push({
      role: "user",
      content: toBedrockMessages([savedToolResult])[0]?.content ?? [],
    });
    // loop again so the model can respond using the tool results
  }
  } finally {
    // Only clear if we're still the registered controller for this chat.
    if (inflight.get(opts.chatId) === ac) inflight.delete(opts.chatId);
  }

  return {
    stopReason: lastStopReason,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    cacheReadTokens: totalCacheRead,
    cacheWriteTokens: totalCacheWrite,
  };
}

// Non-streaming single-shot Converse call. Used by the summarizer.
export async function converseOnce(opts: {
  modelId: string;
  systemText: string;
  userText: string;
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  const client = getRuntimeClient();
  const res = await client.send(
    new ConverseCommand({
      modelId: opts.modelId,
      system: opts.systemText ? [{ text: opts.systemText }] : undefined,
      messages: [{ role: "user", content: [{ text: opts.userText }] }],
      inferenceConfig: {
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
      },
    })
  );
  const blocks = res.output?.message?.content ?? [];
  return blocks
    .map((b) => ("text" in b ? b.text : ""))
    .join("")
    .trim();
}
