import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  role TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_character_created
  ON messages(character_id, created_at);

CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  text TEXT NOT NULL,
  importance REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facts_character ON facts(character_id, importance, updated_at);

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_mentioned_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_character ON topics(character_id, last_mentioned_at);

CREATE TABLE IF NOT EXISTS working (
  character_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  action TEXT,
  room TEXT,
  speech_landed INTEGER NOT NULL DEFAULT 0,
  line TEXT,
  reason TEXT,
  summary TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_character_day
  ON episodes(character_id, day_key, created_at);

CREATE TABLE IF NOT EXISTS diaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  period_key TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(character_id, kind, period_key)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDatabase(dbPath = ":memory:") {
  if (dbPath && dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
  } catch {
    // :memory: or filesystems that reject WAL can ignore this.
  }
  try {
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
  } catch {
    // Some builds or :memory: connections may reject these; schema still loads.
  }
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

export function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row?.value ?? null;
}

export function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, String(value));
}
