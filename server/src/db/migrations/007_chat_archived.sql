-- Archived chats are hidden from the main Chats sidebar and shown in their own
-- view, to keep the active list uncluttered. History is preserved.
ALTER TABLE chats ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chats_archived ON chats(archived, updated_at DESC);
