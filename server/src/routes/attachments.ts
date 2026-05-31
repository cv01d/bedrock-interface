import { Router } from "express";
import { createReadStream, existsSync } from "node:fs";
import { getAttachment } from "../db/repo.js";

export const attachmentsRouter = Router();

// Serves the raw bytes of a stored attachment (user uploads and generated
// images alike) so the client can render them inline. Loopback-only access is
// already enforced by the Host check in index.ts.
attachmentsRouter.get("/:id", (req, res) => {
  const att = getAttachment(Number(req.params.id));
  if (!att || !existsSync(att.path)) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  res.setHeader("Content-Type", att.mime);
  // Never let the browser sniff a different (e.g. executable) type from bytes.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Content is immutable (paths are content-addressed by checksum).
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  // Only images are rendered inline by the client. Everything else (notably
  // uploaded text/html, which would otherwise execute as same-origin script
  // when opened) is forced to download rather than render in this origin.
  const disposition = att.kind === "image" ? "inline" : "attachment";
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${encodeURIComponent(att.name)}"`
  );
  createReadStream(att.path).pipe(res);
});
