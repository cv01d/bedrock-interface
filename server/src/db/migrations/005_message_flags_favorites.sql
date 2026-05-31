-- Per-message "remove from view" flag. Hidden messages are kept in the DB
-- (history is never destroyed) but are excluded from both the rendered
-- transcript and the context sent to the model.
ALTER TABLE messages ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

-- Bookmarked turns. A favorite points at a single message; chat_id is
-- denormalized so the sidebar can list and jump to favorites without scanning
-- messages. ON DELETE CASCADE keeps favorites consistent when a chat or
-- message is removed.
CREATE TABLE IF NOT EXISTS favorites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_favorites_created ON favorites(created_at DESC);
