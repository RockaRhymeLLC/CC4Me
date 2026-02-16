/**
 * SQLite database for CC4Me relay service.
 * Manages agents, messages, and nonces tables.
 */

import Database from 'better-sqlite3';
import { mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DB_PATH = process.env.DB_PATH || join(process.cwd(), 'data', 'relay.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data directory exists
  mkdirSync(dirname(DB_PATH), { recursive: true });

  // Clean up stale WAL/SHM files that may have been left by failed WAL attempts
  // (Azure Files/SMB doesn't support WAL mode properly)
  for (const ext of ['-wal', '-shm']) {
    const f = DB_PATH + ext;
    if (existsSync(f)) {
      try { unlinkSync(f); console.log(`[db] Removed stale ${ext} file`); } catch {}
    }
  }

  _db = new Database(DB_PATH);

  // Busy timeout: allow up to 5s for lock acquisition (important for network storage)
  _db.pragma('busy_timeout = 5000');

  // DELETE journal mode — works reliably on both local and network (SMB) storage.
  // WAL mode requires shared memory that SMB doesn't support.
  _db.pragma('journal_mode = DELETE');
  _db.pragma('foreign_keys = ON');

  // Create tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      owner_email TEXT,
      status TEXT DEFAULT 'pending',
      teams TEXT DEFAULT '[]',
      registered_at TEXT DEFAULT (datetime('now')),
      approved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT,
      payload TEXT NOT NULL,
      signature TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (to_agent) REFERENCES agents(name)
    );

    CREATE TABLE IF NOT EXISTS nonces (
      nonce TEXT PRIMARY KEY,
      seen_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_nonces_seen_at ON nonces(seen_at);
  `);

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Clean up expired messages (>7 days) and stale nonces (>5 minutes).
 */
export function cleanup(): { deletedMessages: number; deletedNonces: number } {
  const db = getDb();
  const msgResult = db.prepare(
    "DELETE FROM messages WHERE created_at < datetime('now', '-7 days')"
  ).run();
  const nonceResult = db.prepare(
    "DELETE FROM nonces WHERE seen_at < datetime('now', '-5 minutes')"
  ).run();
  return {
    deletedMessages: msgResult.changes,
    deletedNonces: nonceResult.changes,
  };
}
