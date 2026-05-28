import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = join(__dirname, "..", "..", "data");
export const ATTACHMENTS_DIR = join(DATA_DIR, "attachments");
const DB_PATH = join(DATA_DIR, "app.db");
const MIGRATIONS_DIR = join(__dirname, "migrations");

mkdirSync(ATTACHMENTS_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// node:sqlite has no transaction() helper — wrap manually.
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

db.exec(
  `CREATE TABLE IF NOT EXISTS _migrations (
     name TEXT PRIMARY KEY,
     applied_at TEXT NOT NULL
   )`
);

const applied = new Set<string>(
  db
    .prepare("SELECT name FROM _migrations")
    .all()
    .map((r) => (r as { name: string }).name)
);

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const record = db.prepare(
  "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)"
);

for (const file of files) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  tx(() => {
    db.exec(sql);
    record.run(file, new Date().toISOString());
  });
  console.log(`[db] applied migration ${file}`);
}
