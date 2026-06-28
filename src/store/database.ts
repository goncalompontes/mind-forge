import Database from "better-sqlite3"
import * as vec from "sqlite-vec"

// ── Singleton ────────────────────────────────────────────────────────────

let db: Database.Database | null = null

// ── Schema SQL ───────────────────────────────────────────────────────────

const SCHEMA_SQL = `
-- Documents table
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  format      TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  author      TEXT,
  text        TEXT NOT NULL DEFAULT '',
  metadata    TEXT NOT NULL DEFAULT '{}',
  ingested_at TEXT NOT NULL
);

-- Document chunks
CREATE TABLE IF NOT EXISTS chunks (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0
);

-- Entities extracted from chunks
CREATE TABLE IF NOT EXISTS entities (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  chunk_id    TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  metadata    TEXT NOT NULL DEFAULT '{}'
);

-- Entity relationships
CREATE TABLE IF NOT EXISTS relationships (
  id              TEXT PRIMARY KEY,
  from_entity_id  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_entity_id    TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  chunk_id        TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  confidence      REAL NOT NULL DEFAULT 1.0
);

-- Study cards (spaced repetition)
CREATE TABLE IF NOT EXISTS study_cards (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_id    TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval    INTEGER NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_date    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Quizzes
CREATE TABLE IF NOT EXISTS quizzes (
  id           TEXT PRIMARY KEY,
  document_ids TEXT NOT NULL DEFAULT '[]',
  questions    TEXT NOT NULL DEFAULT '[]',
  answer_keys  TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);

-- Exam sessions
CREATE TABLE IF NOT EXISTS exams (
  id          TEXT PRIMARY KEY,
  exam_id     TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  submitted_at TEXT,
  score       REAL,
  answers     TEXT NOT NULL DEFAULT '{}'
);

-- Study sessions
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  due_count   INTEGER NOT NULL DEFAULT 0,
  reviewed_count INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL
);

-- Vector search virtual table (sqlite-vec)
-- Dimension 768 matches nomic-embed-text and other common embedding models
CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding FLOAT[768]
);

-- Full-text search virtual table (FTS5) for chunks content
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  content
);
`

// ── Initialization ───────────────────────────────────────────────────────

export function initDatabase(dbPath: string): Database.Database {
  if (db) {
    return db
  }

  const database = new Database(dbPath)

  // Enable WAL mode for concurrent reads
  database.pragma("journal_mode = WAL")
  database.pragma("foreign_keys = ON")

  // Load sqlite-vec extension
  try {
    vec.load(database)
  } catch {
    // sqlite-vec may not be available on all platforms
    console.warn("sqlite-vec extension could not be loaded — vector search disabled")
  }

  // Create schema
  database.exec(SCHEMA_SQL)

  db = database
  return db
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase(dbPath) first.")
  }
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * Get or initialize the database singleton.
 * Convenience wrapper that calls initDatabase if needed.
 */
export function getOrInitDatabase(dbPath: string): Database.Database {
  if (db) return db
  return initDatabase(dbPath)
}
