// Shared types between server and client.

export type Role = "user" | "assistant";

// A single content block inside a message. Mirrors the subset of the Bedrock
// Converse content shape that we persist and render.
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; attachmentId: number; mime: string; name: string }
  | { type: "document"; attachmentId: number; mime: string; name: string }
  | { type: "toolUse"; toolUseId: string; name: string; input: unknown }
  | {
      type: "toolResult";
      toolUseId: string;
      content: SearchHistoryResult[];
      status: "success" | "error";
    };

export interface Message {
  id: number;
  chatId: number;
  seq: number;
  role: Role;
  blocks: ContentBlock[];
  modelId: string | null;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}

export interface ChatSummary {
  id: number;
  projectId: number | null;
  title: string;
  modelId: string;
  updatedAt: string;
}

export interface Chat extends ChatSummary {
  messages: Message[];
  createdAt: string;
  costUsd: number; // running cost of all turns in this chat
  inputTokens: number; // total billed input tokens across all turns
  outputTokens: number; // total output tokens across all turns
}

export interface ProjectSummary {
  id: number;
  name: string;
  updatedAt: string;
}

export interface Project extends ProjectSummary {
  systemPrompt: string;
  projectData: string;
  rollingSummary: string;
  summaryThroughMessageId: number | null;
  createdAt: string;
}

export interface Settings {
  timezone: string;
  temperature: number;
  contextSize: number;
  awsRegion: string;
  defaultSummarizerModelId: string;
  // Never returned with real values — masked indicators only.
  hasAwsAccessKeyId: boolean;
  hasAwsSecretAccessKey: boolean;
}

export interface SettingsUpdate {
  timezone?: string;
  temperature?: number;
  contextSize?: number;
  awsRegion?: string;
  defaultSummarizerModelId?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
}

export interface ModelInfo {
  id: string; // the value to send to Converse (model id or inference profile id/arn)
  label: string;
  provider: string;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsDocuments: boolean;
  isInferenceProfile: boolean;
  // Cross-region inference profiles route outside the home region and are
  // rejected with "Operation not allowed" on sandboxed/restricted accounts.
  crossRegion: boolean;
  // On-demand price in USD per 1M tokens. `estimatedPrice` is true when the
  // rate is a best-effort guess (not a published Claude/Nova rate).
  inputPer1M: number;
  outputPer1M: number;
  estimatedPrice: boolean;
}

export interface AttachmentInfo {
  id: number;
  kind: "image" | "document";
  mime: string;
  name: string;
  size: number;
}

export interface SearchHistoryResult {
  chatId: number;
  chatTitle: string;
  role: Role;
  snippet: string;
  createdAt: string;
}

// SSE event stream sent from POST /api/chats/:id/messages
export type SSEEvent =
  | { type: "start" }
  | { type: "delta"; text: string }
  | { type: "tool_call_start"; toolUseId: string; name: string }
  | { type: "tool_result"; toolUseId: string; resultCount: number }
  | { type: "message_saved"; message: Message }
  | {
      type: "done";
      stopReason: string;
      inputTokens: number; // this turn
      outputTokens: number; // this turn
      chatCostUsd: number; // new running total for the chat after this turn
      chatInputTokens: number; // chat total
      chatOutputTokens: number; // chat total
    }
  | { type: "error"; message: string };

// Request body for sending a message.
export interface SendMessageBody {
  text: string;
  attachmentIds?: number[];
  // Client sets this from the selected model's `supportsTools`. When false,
  // the server omits the history-search tool to avoid a ValidationException
  // from tool-incapable models.
  enableTools?: boolean;
}
