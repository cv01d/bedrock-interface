import { Router } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AttachmentInfo } from "@chat/shared";
import { ATTACHMENTS_DIR } from "../db/index.js";
import { createAttachment, findAttachmentByChecksum } from "../db/repo.js";
import {
  documentFormatFor,
  imageFormatFor,
  sanitizeDocName,
} from "../bedrock/convert.js";

export const uploadRouter = Router();

// Converse limits: images ~3.75 MB, documents ~4.5 MB.
const MAX_IMAGE = 3.75 * 1024 * 1024;
const MAX_DOC = 4.5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC },
});

uploadRouter.post("/", upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded (field name 'file')." });
    return;
  }

  const isImage = imageFormatFor(file.mimetype) !== null;
  const isDoc = documentFormatFor(file.mimetype) !== null;
  if (!isImage && !isDoc) {
    res.status(415).json({
      error: `Unsupported type ${file.mimetype}. Allowed: png/jpeg/gif/webp images; pdf/csv/doc/docx/xls/xlsx/html/txt/md documents.`,
    });
    return;
  }

  if (isImage && file.size > MAX_IMAGE) {
    res.status(413).json({ error: "Image exceeds 3.75 MB limit." });
    return;
  }

  const kind = isImage ? "image" : "document";
  const checksum = createHash("sha256").update(file.buffer).digest("hex");

  // Dedupe identical bytes.
  const existing = findAttachmentByChecksum(checksum);
  if (existing) {
    const info: AttachmentInfo = {
      id: existing.id,
      kind: existing.kind,
      mime: existing.mime,
      name: existing.name,
      size: existing.size,
    };
    res.status(200).json(info);
    return;
  }

  const path = join(ATTACHMENTS_DIR, checksum);
  if (!existsSync(path)) writeFileSync(path, file.buffer);

  const name = sanitizeDocName(
    Buffer.from(file.originalname, "latin1").toString("utf8")
  );

  const row = createAttachment({
    kind,
    name,
    path,
    mime: file.mimetype,
    size: file.size,
    checksum,
  });

  const info: AttachmentInfo = {
    id: row.id,
    kind: row.kind,
    mime: row.mime,
    name: row.name,
    size: row.size,
  };
  res.status(201).json(info);
});
