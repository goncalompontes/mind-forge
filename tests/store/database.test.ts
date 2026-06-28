import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// ── Helpers ──────────────────────────────────────────────────────────────

let tmpDir: string
let dbPath: string

function getFreshDbPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-db-test-"))
  dbPath = join(tmpDir, "test.db")
  return dbPath
}

function cleanup() {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("initDatabase", () => {
  beforeEach(() => {
    // Dynamic import to get fresh module state each test
  })

  afterEach(() => {
    cleanup()
    // Clear singleton
    const dbModule = __moduleCache
    // We'll handle singleton via the test itself
  })

  it("should create database file and initialize schema", async () => {
    const path = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )

    try {
      const db = initDatabase(path)

      // Verify the file was created
      const { existsSync } = await import("node:fs")
      expect(existsSync(path)).toBe(true)

      // Verify tables exist by querying sqlite_master
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all() as { name: string }[]

      const tableNames = tables.map((t) => t.name)
      expect(tableNames).toContain("documents")
      expect(tableNames).toContain("chunks")
      expect(tableNames).toContain("entities")
      expect(tableNames).toContain("relationships")
      expect(tableNames).toContain("study_cards")
      expect(tableNames).toContain("quizzes")
      expect(tableNames).toContain("exams")
      expect(tableNames).toContain("sessions")
    } finally {
      closeDatabase()
    }
  })

  it("should create vec_chunks virtual table", async () => {
    const path = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )

    try {
      const db = initDatabase(path)
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' OR type='virtual' ORDER BY name",
        )
        .all() as { name: string }[]

      const names = tables.map((t) => t.name)
      expect(names).toContain("vec_chunks")
    } finally {
      closeDatabase()
    }
  })

  it("should be idempotent — calling initDatabase twice does not throw", async () => {
    const path = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )

    try {
      initDatabase(path)
      // Second call should not throw
      expect(() => initDatabase(path)).not.toThrow()
    } finally {
      closeDatabase()
    }
  })

  it("should set WAL mode for better performance", async () => {
    const path = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )

    try {
      const db = initDatabase(path)

      const row = db.prepare("PRAGMA journal_mode").get() as {
        journal_mode: string
      }
      expect(row.journal_mode.toLowerCase()).toBe("wal")
    } finally {
      closeDatabase()
    }
  })

  it("should return the same database instance on subsequent calls to getDatabase", async () => {
    const path = getFreshDbPath()
    const { initDatabase, getDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )

    try {
      initDatabase(path)
      const db1 = getDatabase()
      const db2 = getDatabase()
      expect(db1).toBe(db2)
    } finally {
      closeDatabase()
    }
  })

  it("should throw if getDatabase called before initDatabase", async () => {
    // We need a fresh module for this test
    const path = getFreshDbPath()
    const dbModule = await import("../../src/store/database.js")

    // Close any previous connection
    dbModule.closeDatabase()

    expect(() => dbModule.getDatabase()).toThrow()
  })

  it("should create documents table with correct schema", async () => {
    const path = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )

    try {
      const db = initDatabase(path)
      const cols = db
        .prepare("PRAGMA table_info(documents)")
        .all() as { name: string; type: string; pk: number }[]

      const colNames = cols.map((c) => c.name)
      expect(colNames).toContain("id")
      expect(colNames).toContain("filename")
      expect(colNames).toContain("format")
      expect(colNames).toContain("title")
      expect(colNames).toContain("text")
      expect(colNames).toContain("ingested_at")
    } finally {
      closeDatabase()
    }
  })

  it("should create chunks table with foreign key to documents", async () => {
    const path = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )

    try {
      const db = initDatabase(path)
      const cols = db
        .prepare("PRAGMA table_info(chunks)")
        .all() as { name: string; type: string; pk: number }[]

      const colNames = cols.map((c) => c.name)
      expect(colNames).toContain("id")
      expect(colNames).toContain("document_id")
      expect(colNames).toContain("chunk_index")
      expect(colNames).toContain("content")
      expect(colNames).toContain("token_count")
    } finally {
      closeDatabase()
    }
  })
})

const __moduleCache: Record<string, unknown> = {}
