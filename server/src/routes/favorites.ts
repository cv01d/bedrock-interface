import { Router } from "express";
import {
  addFavorite,
  listFavorites,
  removeFavorite,
  renameFavorite,
} from "../db/repo.js";

export const favoritesRouter = Router();

// All bookmarked turns, newest first.
favoritesRouter.get("/", (_req, res) => {
  res.json(listFavorites());
});

// Bookmark a message. Idempotent (UNIQUE on message_id).
favoritesRouter.post("/", (req, res) => {
  const messageId = Number((req.body ?? {}).messageId);
  if (!Number.isFinite(messageId)) {
    res.status(400).json({ error: "messageId is required" });
    return;
  }
  const fav = addFavorite(messageId);
  if (!fav) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  res.status(201).json(fav);
});

// Rename a bookmark (empty/blank label clears it).
favoritesRouter.patch("/:messageId", (req, res) => {
  const label = ((req.body ?? {}).label ?? "").toString();
  const fav = renameFavorite(Number(req.params.messageId), label);
  if (!fav) {
    res.status(404).json({ error: "Favorite not found" });
    return;
  }
  res.json(fav);
});

// Remove a bookmark by its message id.
favoritesRouter.delete("/:messageId", (req, res) => {
  removeFavorite(Number(req.params.messageId));
  res.status(204).end();
});
