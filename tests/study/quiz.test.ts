import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { DocumentChunk, StudyCard } from "../../src/types.js"

// ── Helpers ──────────────────────────────────────────────────────────────

let tmpDir: string

function getFreshDbPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-quiz-test-"))
  return join(tmpDir, "test.db")
}

function cleanup() {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

afterEach(() => {
  cleanup()
})

async function setupSampleData(dbPath: string): Promise<void> {
  const { initDatabase, closeDatabase, getDatabase } = await import(
    "../../src/store/database.js"
  )
  initDatabase(dbPath)
  const db = getDatabase()

  db.prepare(
    `INSERT INTO documents (id, filename, format, title, text, metadata, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "doc-1",
    "science.md",
    "md",
    "Science Notes",
    "Sample science content.",
    "{}",
    new Date().toISOString(),
  )

  const chunks: DocumentChunk[] = [
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

  const stmt = db.prepare(
    `INSERT INTO chunks (id, document_id, chunk_index, content, token_count)
     VALUES (?, ?, ?, ?, ?)`
  )
  for (const chunk of chunks) {
    stmt.run(chunk.id, chunk.documentId, chunk.index, chunk.content, chunk.tokenCount)
  }
}

async function setupWithCards(dbPath: string): Promise<StudyCard[]> {
  await setupSampleData(dbPath)
  const { createCards } = await import("../../src/study/cards.js")
  const { getDatabase } = await import("../../src/store/database.js")
  const db = getDatabase()

  const chunks = db.prepare("SELECT * FROM chunks ORDER BY chunk_index ASC").all() as DocumentChunk[]
  return createCards("doc-1", chunks)
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("generateQuiz", () => {
  it("should generate a quiz with default 5 questions but limited by available cards", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"])

      expect(quiz.id).toBeTruthy()
      expect(quiz.documentIds).toEqual(["doc-1"])
      // Only 3 cards from sample data, so max 3 questions
      expect(quiz.questions.length).toBe(3)
      expect(Object.keys(quiz.answerKeys).length).toBe(3)
      expect(quiz.createdAt).toBeInstanceOf(Date)
    } finally {
      closeDatabase()
    }
  })

  it("should respect custom question count", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"], 3)

      expect(quiz.questions.length).toBe(3)
      expect(Object.keys(quiz.answerKeys).length).toBe(3)
    } finally {
      closeDatabase()
    }
  })

  it("should generate multiple_choice questions with options", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"], 10, ["multiple_choice"])

      for (const q of quiz.questions) {
        expect(q.type).toBe("multiple_choice")
        expect(q.options).toBeDefined()
        expect(q.options!.length).toBe(4) // 3 distractors + 1 correct
        expect(q.options!).toContain(q.answer)
        expect(q.prompt).toBeTruthy()
      }
    } finally {
      closeDatabase()
    }
  })

  it("should generate true_false questions", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"], 5, ["true_false"])

      for (const q of quiz.questions) {
        expect(q.type).toBe("true_false")
        expect(q.options).toEqual(["true", "false"])
        expect(["true", "false"]).toContain(q.answer)
        expect(q.prompt).toBeTruthy()
      }
    } finally {
      closeDatabase()
    }
  })

  it("should generate fill_blank questions", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"], 5, ["fill_blank"])

      for (const q of quiz.questions) {
        expect(q.type).toBe("fill_blank")
        expect(q.prompt).toContain("______")
        expect(q.answer).toBeTruthy()
      }
    } finally {
      closeDatabase()
    }
  })

  it("should generate a mix of question types by default", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"], 10)

      const types = new Set(quiz.questions.map((q) => q.type))
      expect(types.size).toBeGreaterThan(1) // at least 2 different types
    } finally {
      closeDatabase()
    }
  })

  it("should throw when no cards available for document", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      // doc-2 has no chunks or cards
      expect(() => generateQuiz(["doc-2"], 5)).toThrow()
    } finally {
      closeDatabase()
    }
  })

  it("should persist quiz to database", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"])

      const db = getDatabase()
      const row = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(quiz.id) as Record<string, unknown> | undefined
      expect(row).toBeDefined()
      expect(row!.id).toBe(quiz.id)
    } finally {
      closeDatabase()
    }
  })
})

describe("gradeQuiz", () => {
  it("should grade MCQ with exact match", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz, gradeQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"], 3, ["multiple_choice"])

      // Submit all correct answers
      const correctAnswers: Record<string, string> = {}
      for (const q of quiz.questions) {
        correctAnswers[q.id] = q.answer
      }

      const result = gradeQuiz(quiz.id, correctAnswers)
      expect(result.total).toBe(3)
      expect(result.correct).toBe(3)
      expect(result.score).toBe(100)
      expect(result.details.length).toBe(3)
      for (const d of result.details) {
        expect(d.correct).toBe(true)
      }
    } finally {
      closeDatabase()
    }
  })

  it("should grade with partial correctness", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz, gradeQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"], 3)

      // Submit only first 2 correct, last 1 wrong
      const answers: Record<string, string> = {}
      quiz.questions.forEach((q, i) => {
        answers[q.id] = i < 2 ? q.answer : "wrong-answer"
      })

      const result = gradeQuiz(quiz.id, answers)
      expect(result.total).toBe(3)
      expect(result.correct).toBe(2)
      expect(result.score).toBe(67)
    } finally {
      closeDatabase()
    }
  })

  it("should grade true_false with exact match", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz, gradeQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"], 3, ["true_false"])

      const correctAnswers: Record<string, string> = {}
      for (const q of quiz.questions) {
        correctAnswers[q.id] = q.answer
      }

      const result = gradeQuiz(quiz.id, correctAnswers)
      expect(result.score).toBe(100)
    } finally {
      closeDatabase()
    }
  })

  it("should grade fill_blank with case-insensitive comparison", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz, gradeQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"], 3, ["fill_blank"])

      // Submit case-different versions of each answer
      const answers: Record<string, string> = {}
      for (const q of quiz.questions) {
        answers[q.id] = q.answer.toUpperCase()
      }

      const result = gradeQuiz(quiz.id, answers)
      expect(result.correct).toBe(3)
      expect(result.score).toBe(100)
    } finally {
      closeDatabase()
    }
  })

  it("should grade fill_blank trimmed comparison", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { generateQuiz, gradeQuiz } = await import("../../src/study/quiz.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const quiz = generateQuiz(["doc-1"], 3, ["fill_blank"])

      const answers: Record<string, string> = {}
      for (const q of quiz.questions) {
        answers[q.id] = `  ${q.answer}  ` // extra whitespace
      }

      const result = gradeQuiz(quiz.id, answers)
      expect(result.correct).toBe(3)
    } finally {
      closeDatabase()
    }
  })

  it("should throw when quiz not found", async () => {
    const { gradeQuiz } = await import("../../src/study/quiz.js")
    expect(() => gradeQuiz("nonexistent-id", {})).toThrow()
  })
})
