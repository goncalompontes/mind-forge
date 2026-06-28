import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { DocumentChunk } from "../../src/types.js"

// ── Helpers ──────────────────────────────────────────────────────────────

let tmpDir: string

function getFreshDbPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-cards-test-"))
  return join(tmpDir, "test.db")
}

function cleanup() {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

const sampleChunks: DocumentChunk[] = [
  {
    id: "chunk-1",
    documentId: "doc-1",
    index: 0,
    content: "A mitochondrion is the powerhouse of the cell. It generates ATP through cellular respiration.",
    tokenCount: 15,
  },
  {
    id: "chunk-2",
    documentId: "doc-1",
    index: 1,
    content: "Photosynthesis is the process by which plants convert sunlight into chemical energy.",
    tokenCount: 15,
  },
  {
    id: "chunk-3",
    documentId: "doc-1",
    index: 2,
    content: "DNA replication occurs during the S phase of the cell cycle and involves helicase, polymerase, and ligase enzymes.",
    tokenCount: 20,
  },
]

// ── Tests ────────────────────────────────────────────────────────────────

// ── Setup ────────────────────────────────────────────────────────────────

async function insertSampleDocument(dbPath: string): Promise<void> {
  const { getDatabase } = await import("../../src/store/database.js")
  const db = getDatabase()
  db.prepare(
    `INSERT INTO documents (id, filename, format, title, text, metadata, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "doc-1",
    "biology-notes.md",
    "md",
    "Biology Notes",
    "Sample biology content for testing.",
    "{}",
    new Date().toISOString(),
  )

  const stmt = db.prepare(
    `INSERT INTO chunks (id, document_id, chunk_index, content, token_count)
     VALUES (?, ?, ?, ?, ?)`
  )
  for (const chunk of sampleChunks) {
    stmt.run(chunk.id, chunk.documentId, chunk.index, chunk.content, chunk.tokenCount)
  }
}

describe("createCards", () => {
  beforeEach(() => {
    // Dynamic import gets fresh module state
  })

  afterEach(() => {
    cleanup()
  })

  it("should create cards from document chunks", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      const cards = createCards("doc-1", sampleChunks)

      expect(cards.length).toBeGreaterThan(0)
      expect(cards.length).toBeLessThanOrEqual(sampleChunks.length * 3) // reasonable upper bound

      for (const card of cards) {
        expect(card.documentId).toBe("doc-1")
        expect(card.id).toBeTruthy()
        expect(card.question).toBeTruthy()
        expect(card.answer).toBeTruthy()
        expect(card.easeFactor).toBe(2.5)
        expect(card.interval).toBe(0)
        expect(card.repetitions).toBe(0)
        expect(card.dueDate).toBeInstanceOf(Date)
        expect(card.createdAt).toBeInstanceOf(Date)
      }
    } finally {
      closeDatabase()
    }
  })

  it("should create at least one card per chunk with definition content", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      const cards = createCards("doc-1", sampleChunks)

      // Chunk 1 has "X is..." pattern -> should produce "What is X?" cards
      const chunk1Cards = cards.filter((c) => c.chunkId === "chunk-1")
      expect(chunk1Cards.length).toBeGreaterThanOrEqual(1)

      // Some questions should ask "what" and contain "mitochondrion" or "powerhouse"
      const hasMitochondrionQuestion = cards.some(
        (c) =>
          c.chunkId === "chunk-1" &&
          (c.question.includes("mitochondrion") || c.question.includes("powerhouse")),
      )
      expect(hasMitochondrionQuestion).toBe(true)
    } finally {
      closeDatabase()
    }
  })

  it("should persist cards to the database", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      createCards("doc-1", sampleChunks)

      const db = getDatabase()
      const rows = db.prepare("SELECT * FROM study_cards WHERE document_id = ?").all("doc-1") as Record<string, unknown>[]
      expect(rows.length).toBeGreaterThan(0)
    } finally {
      closeDatabase()
    }
  })
})

describe("SM-2 scheduleReview", () => {
  beforeEach(() => {
    // Dynamic import gets fresh module state
  })

  afterEach(() => {
    cleanup()
  })

  it("should reset repetitions when quality < 3 and set interval to 1 day", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards, scheduleReview } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      const cards = createCards("doc-1", sampleChunks)
      const cardId = cards[0].id

      // First, simulate that the card has been reviewed a few times
      const db = getDatabase()
      db.prepare(
        "UPDATE study_cards SET repetitions = 3, interval = 10, ease_factor = 2.5 WHERE id = ?"
      ).run(cardId)

      scheduleReview(cardId, 1) // quality 1 (< 3)

      const row = db.prepare("SELECT * FROM study_cards WHERE id = ?").get(cardId) as Record<string, unknown>
      expect(row.repetitions).toBe(0)
      expect(row.interval).toBe(1)
    } finally {
      closeDatabase()
    }
  })

  it("should set interval to 1 day for first successful review (repetitions == 0)", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards, scheduleReview } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      const db = getDatabase()
      const cards = createCards("doc-1", sampleChunks)
      const cardId = cards[0].id

      scheduleReview(cardId, 4) // quality 4 (>= 3)

      const row = db.prepare("SELECT * FROM study_cards WHERE id = ?").get(cardId) as Record<string, unknown>
      expect(row.repetitions).toBe(1)
      expect(row.interval).toBe(1)
    } finally {
      closeDatabase()
    }
  })

  it("should set interval to 6 days for second successful review (repetitions == 1)", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards, scheduleReview } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      const cards = createCards("doc-1", sampleChunks)
      const cardId = cards[0].id

      // Set up: already reviewed once
      const db = getDatabase()
      db.prepare(
        "UPDATE study_cards SET repetitions = 1, interval = 1, ease_factor = 2.5 WHERE id = ?"
      ).run(cardId)

      scheduleReview(cardId, 4)

      const row = db.prepare("SELECT * FROM study_cards WHERE id = ?").get(cardId) as Record<string, unknown>
      expect(row.repetitions).toBe(2)
      expect(row.interval).toBe(6)
    } finally {
      closeDatabase()
    }
  })

  it("should multiply interval by easeFactor for subsequent reviews", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards, scheduleReview } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      const cards = createCards("doc-1", sampleChunks)
      const cardId = cards[0].id

      // Set up: already reviewed twice (interval is 6, easeFactor is 2.5)
      const db = getDatabase()
      db.prepare(
        "UPDATE study_cards SET repetitions = 2, interval = 6, ease_factor = 2.5 WHERE id = ?"
      ).run(cardId)

      scheduleReview(cardId, 4)

      const row = db.prepare("SELECT * FROM study_cards WHERE id = ?").get(cardId) as Record<string, unknown>
      expect(row.repetitions).toBe(3)
      expect(row.interval).toBe(15) // Math.round(6 * 2.5) = 15
    } finally {
      closeDatabase()
    }
  })

  it("should update easeFactor correctly", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards, scheduleReview } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      const cards = createCards("doc-1", sampleChunks)
      const cardId = cards[0].id

      // Initial easeFactor is 2.5
      // quality = 5 -> EF' = 2.5 + (0.1 - (5-5)*(0.08 + (5-5)*0.02)) = 2.5 + 0.1 = 2.6
      scheduleReview(cardId, 5)

      const db = getDatabase()
      const row = db.prepare("SELECT * FROM study_cards WHERE id = ?").get(cardId) as Record<string, unknown>
      expect(row.ease_factor).toBeCloseTo(2.6, 2)
    } finally {
      closeDatabase()
    }
  })

  it("should clamp easeFactor to minimum of 1.3", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards, scheduleReview } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      const cards = createCards("doc-1", sampleChunks)
      const cardId = cards[0].id

      // Set easeFactor to 1.3 initially
      const db = getDatabase()
      db.prepare(
        "UPDATE study_cards SET repetitions = 1, interval = 1, ease_factor = 1.3 WHERE id = ?"
      ).run(cardId)

      // quality 0 -> EF' = 1.3 + (0.1 - 5*(0.08 + 5*0.02)) = 1.3 + (0.1 - 5*0.18) = 1.3 - 0.8 = 0.5
      // clamp to 1.3
      scheduleReview(cardId, 0)

      const row = db.prepare("SELECT * FROM study_cards WHERE id = ?").get(cardId) as Record<string, unknown>
      expect(row.ease_factor).toBeCloseTo(1.3, 2)
    } finally {
      closeDatabase()
    }
  })

  it("should set dueDate to now + interval days", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards, scheduleReview } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      const db = getDatabase()
      const cards = createCards("doc-1", sampleChunks)
      const cardId = cards[0].id

      const before = new Date()
      scheduleReview(cardId, 4)
      const after = new Date()

      const row = db.prepare("SELECT * FROM study_cards WHERE id = ?").get(cardId) as Record<string, unknown>
      const dueDate = new Date(row.due_date as string)

      // dueDate should be about 1 day from now
      const tomorrow = new Date(before.getTime() + 86400000)
      expect(dueDate.getTime()).toBeGreaterThanOrEqual(tomorrow.getTime() - 5000) // 5s tolerance
      expect(dueDate.getTime()).toBeLessThanOrEqual(after.getTime() + 86400000 + 5000)
    } finally {
      closeDatabase()
    }
  })
})

describe("getDueCards", () => {
  beforeEach(() => {
    // Dynamic import gets fresh module state
  })

  afterEach(() => {
    cleanup()
  })

  it("should return cards where dueDate <= now", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards, getDueCards } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      const cards = createCards("doc-1", sampleChunks)

      // Initially all cards have dueDate = now, so all should be due
      const due = getDueCards()
      expect(due.length).toBe(cards.length)

      // Move one card's due date to the future
      const db = getDatabase()
      db.prepare(
        "UPDATE study_cards SET due_date = ? WHERE id = ?"
      ).run(new Date(Date.now() + 86400000 * 30).toISOString(), cards[0].id)

      const due2 = getDueCards()
      expect(due2.length).toBe(cards.length - 1)
      expect(due2.find((c) => c.id === cards[0].id)).toBeUndefined()
    } finally {
      closeDatabase()
    }
  })

  it("should respect limit parameter", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards, getDueCards } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      createCards("doc-1", sampleChunks)

      const due = getDueCards(1)
      expect(due.length).toBe(1)
    } finally {
      closeDatabase()
    }
  })

  it("should return empty array when no cards are due", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards, getDueCards } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      createCards("doc-1", sampleChunks)

      // Move all cards to far future
      const db = getDatabase()
      db.prepare("UPDATE study_cards SET due_date = ?").run(
        new Date(Date.now() + 86400000 * 365).toISOString()
      )

      const due = getDueCards()
      expect(due).toEqual([])
    } finally {
      closeDatabase()
    }
  })
})

describe("scheduleReview (previously reviewCard)", () => {
  beforeEach(() => {
    // Dynamic import gets fresh module state
  })

  afterEach(() => {
    cleanup()
  })

  it("should update the card via scheduleReview", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createCards, scheduleReview } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      await insertSampleDocument(dbPath)
      const cards = createCards("doc-1", sampleChunks)
      const cardId = cards[0].id

      scheduleReview(cardId, 5)

      const db = getDatabase()
      const row = db.prepare("SELECT * FROM study_cards WHERE id = ?").get(cardId) as Record<string, unknown>
      expect(row.repetitions).toBe(1)
      expect(row.interval).toBe(1)
      expect(row.ease_factor).toBeCloseTo(2.6, 2)
    } finally {
      closeDatabase()
    }
  })

  it("should throw when card does not exist", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { scheduleReview } = await import("../../src/study/cards.js")

    try {
      initDatabase(dbPath)
      expect(() => scheduleReview("nonexistent-id", 3)).toThrow()
    } finally {
      closeDatabase()
    }
  })
})
