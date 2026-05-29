import {
  ConverseCommand,
  ConverseStreamCommand,
  type Message as BedrockMessage,
  type SystemContentBlock,
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
import { addMessage, getMessages } from "../db/repo.js";
import type { Message } from "@chat/shared";

const MAX_TOOL_ROUNDS = 5;

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

  const toolConfig: ToolConfiguration | undefined = opts.includeSearchTool
    ? {
        tools: opts.includeCaching
          ? [searchHistoryTool, cachePoint]
          : [searchHistoryTool],
      }
    : undefined;

  // Seed the conversation from persisted history (already includes the new
  // user message the route saved before calling us), trimmed to context size.
  const convo: BedrockMessage[] = toBedrockMessages(
    trimHistory(getMessages(opts.chatId), opts.maxMessages)
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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
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
      })
    );

    const blocks = new Map<number, AccBlock>();
    let stopReason = "end_turn";
    let roundInput = 0;
    let roundOutput = 0;
    let roundCacheRead = 0;
    let roundCacheWrite = 0;

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

    totalInput += roundInput;
    totalOutput += roundOutput;
    totalCacheRead += roundCacheRead;
    totalCacheWrite += roundCacheWrite;
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
          resultCount: results.length,
        });
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
    convo.push({
      role: "user",
      content: toBedrockMessages([savedToolResult])[0]?.content ?? [],
    });
    // loop again so the model can respond using the tool results
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
