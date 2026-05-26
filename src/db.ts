import DatabaseConstructor from "better-sqlite3";
import type { Database } from "better-sqlite3";

export const db: Database = new DatabaseConstructor("db/users.db");

// init
db.exec(`CREATE TABLE IF NOT EXISTS authors (
  discord_id TEXT PRIMARY KEY,
  author_name TEXT NOT NULL
)`);