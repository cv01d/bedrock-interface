import type {
  Chat,
  ChatSummary,
  ContentBlock,
  Message,
  Project,
  ProjectSummary,
  Role,
  Settings,
} from "@chat/shared";
import { db, tx } from "./index.js";
import {
  decrypt,
  decryptOrEmpty,
  encrypt,
  encryptOrNull,
} from "./crypto.js";
import { costFor } from "../bedrock/pricing.js";

const now = () => new Date().toISOString();

// node:sqlite accepts these as bound parameters.
type SqlParam = string | number | bigint | Uint8Array | null;

// ---------- Settings (singleton row id=1) ----------

interface SettingsRow {
  timezone: string;
  temperature: number;
  context_size: number;
  aws_region: string;
  default_summarizer_model_id: string;
  default_image_model_id: string;
  enc_aws_access_key_id: Uint8Array | null;
  enc_aws_secret_access_key: Uint8Array | null;
  enc_tavily_api_key: Uint8Array | null;
}

const CREDS_DOMAIN = "settings.aws_creds";
const CREDS_AAD = "settings:1";
const TAVILY_DOMAIN = "settings.tavily_api_key";
const TAVILY_AAD = "settings:1";

export function getSettingsRow(): SettingsRow {
  return db
    .prepare("SELECT * FROM settings WHERE id = 1")
    .get() as unknown as SettingsRow;
}

export function getSettings(): Settings {
  const r = getSettingsRow();
  return {
    timezone: r.timezone,
    temperature: r.temperature,
    contextSize: r.context_size,
    awsRegion: r.aws_region,
    defaultSummarizerModelId: r.default_summarizer_model_id,
    defaultImageModelId: r.default_image_model_id,
    hasAwsAccessKeyId: r.enc_aws_access_key_id != null,
    hasAwsSecretAccessKey: r.enc_aws_secret_access_key != null,
    hasTavilyApiKey: r.enc_tavily_api_key != null,
  };
}

// Returns the decrypted Tavily API key, or null if not configured.
export function getTavilyApiKey(): string | null {
  const r = getSettingsRow();
  if (!r.enc_tavily_api_key) return null;
  return decrypt(r.enc_tavily_api_key, TAVILY_DOMAIN, TAVILY_AAD);
}

// Returns decrypted AWS credentials, or null if not fully configured.
export function getAwsCredentials(): {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
} | null {
  const r = getSettingsRow();
  if (!r.enc_aws_access_key_id || !r.enc_aws_secret_access_key) return null;
  return {
    accessKeyId: decrypt(r.enc_aws_access_key_id, CREDS_DOMAIN, CREDS_AAD),
    secretAccessKey: decrypt(
      r.enc_aws_secret_access_key,
      CREDS_DOMAIN,
      CREDS_AAD
    ),
    region: r.aws_region,
  };
}

export function updateSettings(patch: {
  timezone?: string;
  temperature?: number;
  contextSize?: number;
  awsRegion?: string;
  defaultSummarizerModelId?: string;
  defaultImageModelId?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  tavilyApiKey?: string;
}): void {
  const sets: string[] = [];
  const vals: SqlParam[] = [];
  if (patch.timezone !== undefined) {
    sets.push("timezone = ?");
    vals.push(patch.timezone);
  }
  if (patch.temperature !== undefined) {
    sets.push("temperature = ?");
    vals.push(patch.temperature);
  }
  if (patch.contextSize !== undefined) {
    sets.push("context_size = ?");
    vals.push(patch.contextSize);
  }
  if (patch.awsRegion !== undefined) {
    sets.push("aws_region = ?");
    vals.push(patch.awsRegion);
  }
  if (patch.defaultSummarizerModelId !== undefined) {
    sets.push("default_summarizer_model_id = ?");
    vals.push(patch.defaultSummarizerModelId);
  }
  if (patch.defaultImageModelId !== undefined) {
    sets.push("default_image_model_id = ?");
    vals.push(patch.defaultImageModelId);
  }
  if (patch.awsAccessKeyId) {
    sets.push("enc_aws_access_key_id = ?");
    vals.push(encrypt(patch.awsAccessKeyId, CREDS_DOMAIN, CREDS_AAD));
  }
  if (patch.awsSecretAccessKey) {
    sets.push("enc_aws_secret_access_key = ?");
    vals.push(encrypt(patch.awsSecretAccessKey, CREDS_DOMAIN, CREDS_AAD));
  }
  if (patch.tavilyApiKey !== undefined) {
    // Empty string clears the key (disables web search); otherwise encrypt it.
    sets.push("enc_tavily_api_key = ?");
    vals.push(
      patch.tavilyApiKey
        ? encrypt(patch.tavilyApiKey, TAVILY_DOMAIN, TAVILY_AAD)
        : null
    );
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE settings SET ${sets.join(", ")} WHERE id = 1`).run(
    ...vals
  );
}

// ---------- Projects ----------

interface ProjectRow {
  id: number;
  name: string;
  enc_system_prompt: Uint8Array | null;
  enc_project_data: Uint8Array | null;
  enc_rolling_summary: Uint8Array | null;
  summary_through_message_id: number | null;
  created_at: string;
  updated_at: string;
}

const projDomain = (col: string) => `projects.${col}`;
const projAad = (id: number) => `projects:${id}`;

export function listProjects(): ProjectSummary[] {
  const rows = db
    .prepare(
      "SELECT id, name, updated_at FROM projects ORDER BY updated_at DESC"
    )
    .all() as { id: number; name: string; updated_at: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at }));
}

function rowToProject(r: ProjectRow): Project {
  const id = r.id;
  return {
    id,
    name: r.name,
    systemPrompt: decryptOrEmpty(
      r.enc_system_prompt,
      projDomain("system_prompt"),
      projAad(id)
    ),
    projectData: decryptOrEmpty(
      r.enc_project_data,
      projDomain("project_data"),
      projAad(id)
    ),
    rollingSummary: decryptOrEmpty(
      r.enc_rolling_summary,
      projDomain("rolling_summary"),
      projAad(id)
    ),
    summaryThroughMessageId: r.summary_through_message_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getProject(id: number): Project | null {
  const r = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return r ? rowToProject(r) : null;
}

export function createProject(name: string): Project {
  const ts = now();
  const info = db
    .prepare(
      "INSERT INTO projects (name, created_at, updated_at) VALUES (?, ?, ?)"
    )
    .run(name, ts, ts);
  return getProject(Number(info.lastInsertRowid))!;
}

export function updateProject(
  id: number,
  patch: {
    name?: string;
    systemPrompt?: string;
    projectData?: string;
    rollingSummary?: string;
    summaryThroughMessageId?: number;
  }
): Project | null {
  const sets: string[] = [];
  const vals: SqlParam[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    vals.push(patch.name);
  }
  if (patch.systemPrompt !== undefined) {
    sets.push("enc_system_prompt = ?");
    vals.push(
      encryptOrNull(patch.systemPrompt, projDomain("system_prompt"), projAad(id))
    );
  }
  if (patch.projectData !== undefined) {
    sets.push("enc_project_data = ?");
    vals.push(
      encryptOrNull(patch.projectData, projDomain("project_data"), projAad(id))
    );
  }
  if (patch.rollingSummary !== undefined) {
    sets.push("enc_rolling_summary = ?");
    vals.push(
      encryptOrNull(
        patch.rollingSummary,
        projDomain("rolling_summary"),
        projAad(id)
      )
    );
  }
  if (patch.summaryThroughMessageId !== undefined) {
    sets.push("summary_through_message_id = ?");
    vals.push(patch.summaryThroughMessageId);
  }
  sets.push("updated_at = ?");
  vals.push(now());
  vals.push(id);
  db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return getProject(id);
}

export function deleteProject(id: number): void {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

// ---------- Chats ----------

interface ChatRow {
  id: number;
  project_id: number | null;
  title: string;
  model_id: string;
  enc_system_prompt_snapshot: Uint8Array | null;
  created_at: string;
  updated_at: string;
}

const SNAPSHOT_DOMAIN = "chats.system_prompt_snapshot";
const chatAad = (id: number) => `chats:${id}`;

export function listChats(): ChatSummary[] {
  const rows = db
    .prepare(
      "SELECT id, project_id, title, model_id, updated_at FROM chats ORDER BY updated_at DESC"
    )
    .all() as {
    id: number;
    project_id: number | null;
    title: string;
    model_id: string;
    updated_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    modelId: r.model_id,
    updatedAt: r.updated_at,
  }));
}

export function createChat(
  modelId: string,
  projectId: number | null,
  systemPromptSnapshot: string
): ChatSummary {
  const ts = now();
  const info = db
    .prepare(
      "INSERT INTO chats (project_id, title, model_id, created_at, updated_at) VALUES (?, 'New chat', ?, ?, ?)"
    )
    .run(projectId, modelId, ts, ts);
  const id = Number(info.lastInsertRowid);
  if (systemPromptSnapshot) {
    db.prepare("UPDATE chats SET enc_system_prompt_snapshot = ? WHERE id = ?").run(
      encrypt(systemPromptSnapshot, SNAPSHOT_DOMAIN, chatAad(id)),
      id
    );
  }
  return {
    id,
    projectId,
    title: "New chat",
    modelId,
    updatedAt: ts,
  };
}

export function getChatRow(id: number): ChatRow | undefined {
  return db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as
    | ChatRow
    | undefined;
}

export function getChatSnapshot(id: number): string {
  const r = getChatRow(id);
  if (!r) return "";
  return decryptOrEmpty(
    r.enc_system_prompt_snapshot,
    SNAPSHOT_DOMAIN,
    chatAad(id)
  );
}

export interface ChatUsage {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

function usageOf(messages: Message[]): ChatUsage {
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const m of messages) {
    costUsd += costFor(
      m.modelId,
      m.inputTokens,
      m.outputTokens,
      m.cacheReadTokens,
      m.cacheWriteTokens
    );
    // Bedrock splits input across uncached / cache-read / cache-write; sum all
    // three so the "in" count reflects the true prompt size.
    inputTokens +=
      (m.inputTokens ?? 0) +
      (m.cacheReadTokens ?? 0) +
      (m.cacheWriteTokens ?? 0);
    outputTokens += m.outputTokens ?? 0;
  }
  return { costUsd, inputTokens, outputTokens };
}

export function getChat(id: number): Chat | null {
  const r = getChatRow(id);
  if (!r) return null;
  const messages = getMessages(id);
  const usage = usageOf(messages);
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    modelId: r.model_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messages,
    costUsd: usage.costUsd,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  };
}

// Cost + token totals across all turns in a chat.
export function getChatUsage(id: number): ChatUsage {
  return usageOf(getMessages(id));
}

export function updateChat(
  id: number,
  patch: { title?: string; modelId?: string }
): ChatSummary | null {
  const sets: string[] = [];
  const vals: SqlParam[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    vals.push(patch.title);
  }
  if (patch.modelId !== undefined) {
    sets.push("model_id = ?");
    vals.push(patch.modelId);
  }
  if (sets.length === 0) return null;
  sets.push("updated_at = ?");
  vals.push(now());
  vals.push(id);
  db.prepare(`UPDATE chats SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  const r = getChatRow(id)!;
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    modelId: r.model_id,
    updatedAt: r.updated_at,
  };
}

export function touchChat(id: number): void {
  db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(now(), id);
}

export function deleteChat(id: number): void {
  db.prepare("DELETE FROM chats WHERE id = ?").run(id);
}

// ---------- Messages ----------

interface MessageRow {
  id: number;
  chat_id: number;
  seq: number;
  role: Role;
  enc_content: Uint8Array | null;
  model_id: string | null;
  stop_reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  created_at: string;
}

const MSG_DOMAIN = "messages.content";
const msgAad = (id: number) => `messages:${id}`;

function rowToMessage(r: MessageRow): Message {
  const blocks: ContentBlock[] = r.enc_content
    ? JSON.parse(decrypt(r.enc_content, MSG_DOMAIN, msgAad(r.id)))
    : [];
  return {
    id: r.id,
    chatId: r.chat_id,
    seq: r.seq,
    role: r.role,
    blocks,
    modelId: r.model_id,
    stopReason: r.stop_reason,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadTokens: r.cache_read_tokens,
    cacheWriteTokens: r.cache_write_tokens,
    createdAt: r.created_at,
  };
}

export function getMessages(chatId: number): Message[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY seq ASC")
    .all(chatId) as unknown as MessageRow[];
  return rows.map(rowToMessage);
}

function nextSeq(chatId: number): number {
  const r = db
    .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM messages WHERE chat_id = ?")
    .get(chatId) as { n: number };
  return r.n;
}

export function addMessage(input: {
  chatId: number;
  role: Role;
  blocks: ContentBlock[];
  modelId?: string | null;
  stopReason?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}): Message {
  const ts = now();
  const seq = nextSeq(input.chatId);
  const info = db
    .prepare(
      `INSERT INTO messages
         (chat_id, seq, role, model_id, stop_reason, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.chatId,
      seq,
      input.role,
      input.modelId ?? null,
      input.stopReason ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.cacheReadTokens ?? null,
      input.cacheWriteTokens ?? null,
      ts
    );
  const id = Number(info.lastInsertRowid);
  db.prepare("UPDATE messages SET enc_content = ? WHERE id = ?").run(
    encrypt(JSON.stringify(input.blocks), MSG_DOMAIN, msgAad(id)),
    id
  );
  touchChat(input.chatId);
  return {
    id,
    chatId: input.chatId,
    seq,
    role: input.role,
    blocks: input.blocks,
    modelId: input.modelId ?? null,
    stopReason: input.stopReason ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    cacheReadTokens: input.cacheReadTokens ?? null,
    cacheWriteTokens: input.cacheWriteTokens ?? null,
    createdAt: ts,
  };
}

// Decrypt messages for the history-search tool. Bounded scan over recent rows.
export function searchMessages(opts: {
  projectId?: number;
  sinceDays: number;
  scanLimit: number;
}): {
  chatId: number;
  chatTitle: string;
  role: Role;
  text: string;
  createdAt: string;
}[] {
  const sinceIso = new Date(
    Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const params: SqlParam[] = [sinceIso];
  let projectFilter = "";
  if (opts.projectId != null) {
    projectFilter = "AND c.project_id = ?";
    params.push(opts.projectId);
  }
  params.push(opts.scanLimit);

  const rows = db
    .prepare(
      `SELECT m.id, m.chat_id, m.role, m.enc_content, m.created_at, c.title
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
        WHERE m.created_at >= ? ${projectFilter}
        ORDER BY m.created_at DESC
        LIMIT ?`
    )
    .all(...params) as unknown as (MessageRow & { title: string })[];

  const out: {
    chatId: number;
    chatTitle: string;
    role: Role;
    text: string;
    createdAt: string;
  }[] = [];
  for (const r of rows) {
    if (!r.enc_content) continue;
    const blocks: ContentBlock[] = JSON.parse(
      decrypt(r.enc_content, MSG_DOMAIN, msgAad(r.id))
    );
    const text = blocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join(" ")
      .trim();
    if (!text) continue;
    out.push({
      chatId: r.chat_id,
      chatTitle: r.title,
      role: r.role,
      text,
      createdAt: r.created_at,
    });
  }
  return out;
}

// Messages across a project for the summarizer, after a watermark id.
export function getProjectMessagesAfter(
  projectId: number,
  afterMessageId: number
): { id: number; role: Role; text: string }[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.role, m.enc_content
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
        WHERE c.project_id = ? AND m.id > ?
        ORDER BY m.id ASC`
    )
    .all(projectId, afterMessageId) as unknown as MessageRow[];

  return rows
    .map((r) => {
      const blocks: ContentBlock[] = r.enc_content
        ? JSON.parse(decrypt(r.enc_content, MSG_DOMAIN, msgAad(r.id)))
        : [];
      const text = blocks
        .map((b) => (b.type === "text" ? b.text : ""))
        .join(" ")
        .trim();
      return { id: r.id, role: r.role, text };
    })
    .filter((m) => m.text.length > 0);
}

// ---------- Attachments ----------

interface AttachmentRow {
  id: number;
  message_id: number | null;
  kind: "image" | "document";
  name: string;
  path: string;
  mime: string;
  size: number;
  checksum: string;
  created_at: string;
}

export function createAttachment(input: {
  kind: "image" | "document";
  name: string;
  path: string;
  mime: string;
  size: number;
  checksum: string;
}): AttachmentRow {
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO attachments (kind, name, path, mime, size, checksum, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.kind,
      input.name,
      input.path,
      input.mime,
      input.size,
      input.checksum,
      ts
    );
  return getAttachment(Number(info.lastInsertRowid))!;
}

export function getAttachment(id: number): AttachmentRow | undefined {
  return db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as
    | AttachmentRow
    | undefined;
}

export function findAttachmentByChecksum(
  checksum: string
): AttachmentRow | undefined {
  return db
    .prepare("SELECT * FROM attachments WHERE checksum = ? LIMIT 1")
    .get(checksum) as AttachmentRow | undefined;
}

export function getAttachments(ids: number[]): AttachmentRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM attachments WHERE id IN (${placeholders})`)
    .all(...ids) as unknown as AttachmentRow[];
}

export function linkAttachmentsToMessage(
  attachmentIds: number[],
  messageId: number
): void {
  if (attachmentIds.length === 0) return;
  const stmt = db.prepare(
    "UPDATE attachments SET message_id = ? WHERE id = ?"
  );
  tx(() => {
    for (const aid of attachmentIds) stmt.run(messageId, aid);
  });
}

export type { AttachmentRow };
