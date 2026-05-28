import { readFileSync } from "node:fs";
import type {
  ContentBlock as BedrockContentBlock,
  Message as BedrockMessage,
} from "@aws-sdk/client-bedrock-runtime";
import type { ContentBlock, Message } from "@chat/shared";
import { getAttachment } from "../db/repo.js";

const IMAGE_FORMATS: Record<string, "png" | "jpeg" | "gif" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const DOC_FORMATS: Record<string, string> = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/html": "html",
  "text/plain": "txt",
  "text/markdown": "md",
};

export function imageFormatFor(mime: string): "png" | "jpeg" | "gif" | "webp" | null {
  return IMAGE_FORMATS[mime] ?? null;
}

export function documentFormatFor(mime: string): string | null {
  return DOC_FORMATS[mime] ?? null;
}

// Bedrock document names must match [a-zA-Z0-9\s\-()[\]] only.
export function sanitizeDocName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9\s\-()[\]]/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "document";
}

function blockToBedrock(block: ContentBlock): BedrockContentBlock | null {
  switch (block.type) {
    case "text":
      return { text: block.text };
    case "image": {
      const att = getAttachment(block.attachmentId);
      const format = imageFormatFor(block.mime);
      if (!att || !format) return null;
      return {
        image: {
          format,
          source: { bytes: readFileSync(att.path) },
        },
      };
    }
    case "document": {
      const att = getAttachment(block.attachmentId);
      const format = documentFormatFor(block.mime);
      if (!att || !format) return null;
      return {
        document: {
          format: format as never,
          name: sanitizeDocName(block.name),
          source: { bytes: readFileSync(att.path) },
        },
      };
    }
    case "toolUse":
      return {
        toolUse: {
          toolUseId: block.toolUseId,
          name: block.name,
          input: block.input as never,
        },
      };
    case "toolResult":
      return {
        toolResult: {
          toolUseId: block.toolUseId,
          status: block.status,
          content: [{ json: { results: block.content } as never }],
        },
      };
    default:
      return null;
  }
}

export function toBedrockMessages(messages: Message[]): BedrockMessage[] {
  const out: BedrockMessage[] = [];
  for (const m of messages) {
    const content = m.blocks
      .map(blockToBedrock)
      .filter((b): b is BedrockContentBlock => b !== null);
    if (content.length === 0) continue;
    out.push({ role: m.role, content });
  }
  return out;
}
