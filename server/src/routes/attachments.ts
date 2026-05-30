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
  // Content is immutable (paths are content-addressed by checksum).
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(att.name)}"`
  );
  createReadStream(att.path).pipe(res);
});
