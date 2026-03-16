// src/db.js — SQLite setup via better-sqlite3
// Tables: issues, usage, licenses
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(process.cwd(), 'contribbridge.db');

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
    original_title   TEXT, -- Added for UI persistence
    original_body    TEXT, -- Added for UI persistence
    author           TEXT, -- Added for UI persistence
    confidence    REAL,
    created_at    TEXT    NOT NULL
  );
`);

// Migration: Add original content columns if they don't exist
try {
  const columns = db.prepare("PRAGMA table_info(issues)").all();
  if (!columns.find(c => c.name === 'original_title')) {
    db.exec("ALTER TABLE issues ADD COLUMN original_title TEXT");
  }
  if (!columns.find(c => c.name === 'original_body')) {
    db.exec("ALTER TABLE issues ADD COLUMN original_body TEXT");
  }
  if (!columns.find(c => c.name === 'author')) {
    db.exec("ALTER TABLE issues ADD COLUMN author TEXT");
  }
} catch (e) {
  console.warn('[DB] Migration check failed (likely columns already exist):', e.message);
}

db.exec(`

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

  CREATE TABLE IF NOT EXISTS watched_repos (
    repo        TEXT PRIMARY KEY,
    mode        TEXT NOT NULL, -- 'webhook' or 'polling'
    last_polled TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS repo_locales (
    repo          TEXT NOT NULL,
    target_locale TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (repo, target_locale),
    FOREIGN KEY (repo) REFERENCES watched_repos(repo)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id            INTEGER PRIMARY KEY,
    repo          TEXT    NOT NULL,
    issue_number  INTEGER NOT NULL,
    author        TEXT    NOT NULL,
    original_body TEXT,
    translated_body TEXT,
    direction     TEXT, -- 'to-maintainer' or 'to-contributor'
    locale        TEXT,
    comment_url   TEXT,
    created_at    TEXT    NOT NULL
  );
`);

export default db;
