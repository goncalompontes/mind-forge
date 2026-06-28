import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { DocumentChunk } from "../../src/types.js"

// ── Helpers ──────────────────────────────────────────────────────────────

let tmpDir: string

function getFreshDbPath(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "mind-forge-exam-test-"))
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

async function setupWithCards(dbPath: string): Promise<void> {
  const { initDatabase, getDatabase } = await import(
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

  const { createCards } = await import("../../src/study/cards.js")
  createCards("doc-1", chunks)
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("createExam", () => {
  it("should create an exam with specified config", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createExam } = await import("../../src/study/exam.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)

      const exam = createExam(["doc-1"], {
        questionCount: 3,
        durationMinutes: 30,
      })

      expect(exam.id).toBeTruthy()
      expect(exam.documentIds).toEqual(["doc-1"])
      expect(exam.questions.length).toBe(3)
      expect(exam.config.durationMinutes).toBe(30)
      expect(exam.config.questionCount).toBe(3)
      expect(exam.startedAt).toBeUndefined()
      expect(exam.submittedAt).toBeUndefined()
    } finally {
      closeDatabase()
    }
  })

  it("should accept custom question types", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createExam } = await import("../../src/study/exam.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)

      const exam = createExam(["doc-1"], {
        questionCount: 3,
        durationMinutes: 60,
        types: ["multiple_choice"],
      })

      for (const q of exam.questions) {
        expect(q.type).toBe("multiple_choice")
      }
    } finally {
      closeDatabase()
    }
  })

  it("should persist exam session to quizzes table", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createExam } = await import("../../src/study/exam.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)

      const exam = createExam(["doc-1"], {
        questionCount: 3,
        durationMinutes: 30,
      })

      const db = getDatabase()
      // Exam data is stored in quizzes table (createExam wraps generateQuiz)
      const row = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(exam.id) as Record<string, unknown> | undefined
      expect(row).toBeDefined()
      expect(row!.id).toBe(exam.id)
    } finally {
      closeDatabase()
    }
  })
})

describe("startExam", () => {
  it("should record the start time", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createExam, startExam } = await import("../../src/study/exam.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const exam = createExam(["doc-1"], { questionCount: 3, durationMinutes: 30 })

      const before = new Date()
      const started = startExam(exam.id)
      const after = new Date()

      expect(started.startedAt).toBeInstanceOf(Date)
      expect(started.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)
      expect(started.startedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000)
    } finally {
      closeDatabase()
    }
  })

  it("should persist start time to database", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createExam, startExam } = await import("../../src/study/exam.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const exam = createExam(["doc-1"], { questionCount: 3, durationMinutes: 30 })
      startExam(exam.id)

      const db = getDatabase()
      // exams table uses exam_id to reference the quiz
      const row = db.prepare("SELECT * FROM exams WHERE exam_id = ?").get(exam.id) as Record<string, unknown> | undefined
      expect(row).toBeDefined()
      expect(row!.started_at).toBeTruthy()
    } finally {
      closeDatabase()
    }
  })

  it("should throw when exam not found", async () => {
    const { startExam } = await import("../../src/study/exam.js")
    expect(() => startExam("nonexistent-id")).toThrow()
  })
})

describe("submitExam", () => {
  it("should auto-grade and compute score", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createExam, startExam, submitExam } = await import(
      "../../src/study/exam.js"
    )

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const exam = createExam(["doc-1"], { questionCount: 3, durationMinutes: 30 })
      startExam(exam.id)

      // Submit all correct answers
      const correctAnswers: Record<string, string> = {}
      for (const q of exam.questions) {
        correctAnswers[q.id] = exam.answerKeys[q.id]
      }

      const result = submitExam(exam.id, correctAnswers)
      expect(result.score).toBe(100)
      expect(result.total).toBe(3)
      expect(result.correct).toBe(3)
      expect(result.submittedAt).toBeInstanceOf(Date)
    } finally {
      closeDatabase()
    }
  })

  it("should compute partial score", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createExam, startExam, submitExam } = await import(
      "../../src/study/exam.js"
    )

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const exam = createExam(["doc-1"], { questionCount: 3, durationMinutes: 30 })
      startExam(exam.id)

      // Half correct
      const answers: Record<string, string> = {}
      exam.questions.forEach((q, i) => {
        answers[q.id] = i === 0 ? exam.answerKeys[q.id] : "wrong"
      })

      const result = submitExam(exam.id, answers)
      expect(result.score).toBe(33)
      expect(result.correct).toBe(1)
      expect(result.total).toBe(3)
    } finally {
      closeDatabase()
    }
  })

  it("should persist submission to database", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase, getDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createExam, startExam, submitExam } = await import(
      "../../src/study/exam.js"
    )

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const exam = createExam(["doc-1"], { questionCount: 3, durationMinutes: 30 })
      startExam(exam.id)

      const correctAnswers: Record<string, string> = {}
      for (const q of exam.questions) {
        correctAnswers[q.id] = exam.answerKeys[q.id]
      }
      submitExam(exam.id, correctAnswers)

      const db = getDatabase()
      const row = db.prepare("SELECT * FROM exams WHERE exam_id = ?").get(exam.id) as Record<string, unknown> | undefined
      expect(row).toBeDefined()
      expect(row!.submitted_at).toBeTruthy()
      expect(row!.score).toBe(100)
    } finally {
      closeDatabase()
    }
  })

  it("should throw when exam not found", async () => {
    const { submitExam } = await import("../../src/study/exam.js")
    expect(() => submitExam("nonexistent-id", {})).toThrow()
  })

  it("should throw when exam not started", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createExam, submitExam } = await import("../../src/study/exam.js")

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const exam = createExam(["doc-1"], { questionCount: 3, durationMinutes: 30 })

      expect(() => submitExam(exam.id, {})).toThrow()
    } finally {
      closeDatabase()
    }
  })
})

describe("getExamResult", () => {
  it("should return full exam result with score and time taken", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createExam, startExam, submitExam, getExamResult } = await import(
      "../../src/study/exam.js"
    )

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const exam = createExam(["doc-1"], { questionCount: 3, durationMinutes: 30 })
      startExam(exam.id)

      const correctAnswers: Record<string, string> = {}
      for (const q of exam.questions) {
        correctAnswers[q.id] = exam.answerKeys[q.id]
      }
      submitExam(exam.id, correctAnswers)

      const result = getExamResult(exam.id)
      expect(result.score).toBe(100)
      expect(result.correct).toBe(3)
      expect(result.total).toBe(3)
      expect(result.timeTaken).toBeGreaterThanOrEqual(0)
      expect(result.details.length).toBe(3)
      for (const d of result.details) {
        expect(d.correct).toBe(true)
      }
    } finally {
      closeDatabase()
    }
  })

  it("should throw when exam not found", async () => {
    const { getExamResult } = await import("../../src/study/exam.js")
    expect(() => getExamResult("nonexistent-id")).toThrow()
  })

  it("should throw when exam not yet submitted", async () => {
    const dbPath = getFreshDbPath()
    const { initDatabase, closeDatabase } = await import(
      "../../src/store/database.js"
    )
    const { createExam, startExam, getExamResult } = await import(
      "../../src/study/exam.js"
    )

    try {
      initDatabase(dbPath)
      await setupWithCards(dbPath)
      const exam = createExam(["doc-1"], { questionCount: 3, durationMinutes: 30 })
      startExam(exam.id)

      expect(() => getExamResult(exam.id)).toThrow()
    } finally {
      closeDatabase()
    }
  })
})
