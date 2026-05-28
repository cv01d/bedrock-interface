import { Router } from "express";
import type { ContentBlock, SendMessageBody } from "@chat/shared";
import {
  addMessage,
  createChat,
  deleteChat,
  getAttachments,
  getChat,
  getChatUsage,
  getChatRow,
  getChatSnapshot,
  getProject,
  getSettings,
  linkAttachmentsToMessage,
  listChats,
  updateChat,
} from "../db/repo.js";
import { buildSnapshot, buildSystemText } from "../services/context.js";
import { streamChat } from "../bedrock/converse.js";
import { NoCredentialsError } from "../bedrock/client.js";
import { explainBedrockError } from "../bedrock/errors.js";
import { imageFormatFor, documentFormatFor } from "../bedrock/convert.js";
import { openSSE } from "../sse.js";

export const chatsRouter = Router();

chatsRouter.get("/", (_req, res) => {
  res.json(listChats());
});

chatsRouter.post("/", (req, res) => {
  const modelId = (req.body?.modelId ?? "").toString();
  if (!modelId) {
    res.status(400).json({ error: "modelId is required" });
    return;
  }
  const projectId =
    req.body?.projectId != null ? Number(req.body.projectId) : null;
  const project = projectId != null ? getProject(projectId) : null;
  const snapshot = buildSnapshot(project);
  res.status(201).json(createChat(modelId, projectId, snapshot));
});

chatsRouter.get("/:id", (req, res) => {
  const chat = getChat(Number(req.params.id));
  if (!chat) {
    res.status(404).json({ error: "Chat not found" });
    return;
  }
  res.json(chat);
});

chatsRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!getChatRow(id)) {
    res.status(404).json({ error: "Chat not found" });
    return;
  }
  const { title, modelId } = req.body ?? {};
  res.json(updateChat(id, { title, modelId }));
});

chatsRouter.delete("/:id", (req, res) => {
  deleteChat(Number(req.params.id));
  res.status(204).end();
});

chatsRouter.post("/:id/messages", async (req, res) => {
  const chatId = Number(req.params.id);
  const chatRow = getChatRow(chatId);
  if (!chatRow) {
    res.status(404).json({ error: "Chat not found" });
    return;
  }

  const body = req.body as SendMessageBody;
  const text = (body.text ?? "").toString();
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map(Number)
    : [];

  if (!text.trim() && attachmentIds.length === 0) {
    res.status(400).json({ error: "Message is empty." });
    return;
  }

  // Build the user message blocks (attachments first, then text).
  const blocks: ContentBlock[] = [];
  const attachments = getAttachments(attachmentIds);
  for (const att of attachments) {
    if (att.kind === "image" && imageFormatFor(att.mime)) {
      blocks.push({
        type: "image",
        attachmentId: att.id,
        mime: att.mime,
        name: att.name,
      });
    } else if (att.kind === "document" && documentFormatFor(att.mime)) {
      blocks.push({
        type: "document",
        attachmentId: att.id,
        mime: att.mime,
        name: att.name,
      });
    }
  }
  if (text.trim()) blocks.push({ type: "text", text });

  const userMsg = addMessage({ chatId, role: "user", blocks });
  linkAttachmentsToMessage(attachmentIds, userMsg.id);

  // Auto-title the chat from the first user message.
  if (chatRow.title === "New chat" && text.trim()) {
    updateChat(chatId, { title: text.trim().slice(0, 60) });
  }

  // Assemble system text: frozen snapshot + live project memory + dated preamble.
  const settings = getSettings();
  const project =
    chatRow.project_id != null ? getProject(chatRow.project_id) : null;
  const systemText = buildSystemText({
    snapshot: getChatSnapshot(chatId),
    liveRollingSummary: project?.rollingSummary ?? "",
    settings,
  });

  const sse = openSSE(res);
  // If the client disconnects mid-stream, stop work where we can. Use the
  // response's "close" (not the request's): on a POST, req "close" fires as
  // soon as the request body is consumed — long before the client goes away —
  // which would silence the whole stream. res "close" only fires early on a
  // genuine disconnect; on normal completion it fires after the response ends.
  let aborted = false;
  res.on("close", () => {
    if (!res.writableFinished) aborted = true;
  });

  try {
    const result = await streamChat({
      chatId,
      projectId: chatRow.project_id,
      modelId: chatRow.model_id,
      systemText,
      temperature: settings.temperature,
      maxTokens: 4096,
      maxMessages: settings.contextSize,
      includeSearchTool: body.enableTools !== false,
      emit: (e) => {
        if (!aborted) sse.send(e);
      },
    });
    const usage = getChatUsage(chatId);
    sse.send({
      type: "done",
      stopReason: result.stopReason,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      chatCostUsd: usage.costUsd,
      chatInputTokens: usage.inputTokens,
      chatOutputTokens: usage.outputTokens,
    });
  } catch (err) {
    const raw =
      err instanceof NoCredentialsError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    const message =
      err instanceof NoCredentialsError ? raw : explainBedrockError(raw);
    sse.send({ type: "error", message });
  } finally {
    sse.close();
  }
});
