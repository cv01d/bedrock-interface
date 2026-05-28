-- enc_* columns are AES-256-GCM blobs: version(1) || iv(12) || ciphertext || tag(16)

CREATE TABLE IF NOT EXISTS settings (
  id                          INTEGER PRIMARY KEY CHECK (id = 1),
  timezone                    TEXT    NOT NULL DEFAULT 'UTC',
  temperature                 REAL    NOT NULL DEFAULT 0.7,
  context_size                INTEGER NOT NULL DEFAULT 20,
  aws_region                  TEXT    NOT NULL DEFAULT 'us-east-1',
  default_summarizer_model_id TEXT    NOT NULL DEFAULT '',
  enc_aws_access_key_id       BLOB,
  enc_aws_secret_access_key   BLOB
);

INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS projects (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  name                        TEXT    NOT NULL,
  enc_system_prompt           BLOB,
  enc_project_data            BLOB,
  enc_rolling_summary         BLOB,
  summary_through_message_id  INTEGER,
  created_at                  TEXT    NOT NULL,
  updated_at                  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id                  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title                       TEXT    NOT NULL DEFAULT 'New chat',
  model_id                    TEXT    NOT NULL,
  enc_system_prompt_snapshot  BLOB,
  created_at                  TEXT    NOT NULL,
  updated_at                  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id       INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  role          TEXT    NOT NULL,
  enc_content   BLOB,
  model_id      TEXT,
  stop_reason   TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_seq ON messages(chat_id, seq);

CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  mime        TEXT    NOT NULL,
  size        INTEGER NOT NULL,
  checksum    TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_checksum ON attachments(checksum);
