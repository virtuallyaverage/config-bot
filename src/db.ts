import DatabaseConstructor from "better-sqlite3";
import type { Database } from "better-sqlite3";

export const db: Database = new DatabaseConstructor("db/users.db");

// init
db.exec(`CREATE TABLE IF NOT EXISTS authors (
  discord_id  TEXT PRIMARY KEY,                  -- identity anchor, never changes
  author_name TEXT NOT NULL UNIQUE,              -- immutable, embedded in game logic
  author_id   TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS staged (
  id          INTEGER PRIMARY KEY,               -- rowid alias, auto-increments
  discord_id  TEXT NOT NULL REFERENCES authors(discord_id) ON DELETE CASCADE,
  name        TEXT,
  version     INTEGER,
  file        BLOB,
  staged_at   INTEGER NOT NULL DEFAULT (unixepoch())
)`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_staged_discord_id ON staged(discord_id)`);

const getAuthorNameStmt = db.prepare(
  "SELECT author_name FROM authors WHERE discord_id = ?",
);

export function getAuthorName(discordId: string): string | null {
  const row = getAuthorNameStmt.get(discordId) as
    | { author_name: string }
    | undefined;
  return row?.author_name ?? null;
}

db.pragma("foreign_keys = ON");
