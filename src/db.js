// src/db.js — SQLite setup via better-sqlite3
// Tables: issues, usage, licenses
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'contribbridge.db');

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read/write performance
db.pragma('journal_mode = WAL');

// ─── Schema ──────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS issues (
    id            INTEGER PRIMARY KEY,
    repo          TEXT    NOT NULL,
    issue_number  INTEGER NOT NULL,
    locale        TEXT    NOT NULL,
    translated_title TEXT,
    translated_body  TEXT,
    confidence    REAL,
    created_at    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id     TEXT    NOT NULL,
    repo       TEXT    NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    month      TEXT    NOT NULL,
    created_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS licenses (
    org_id     TEXT PRIMARY KEY,
    tier       TEXT NOT NULL,
    license_key TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
`);

export default db;
