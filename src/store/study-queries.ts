// ── Study Card / Quiz / Exam Queries ─────────────────────────────────────
// Spaced repetition (SM-2) cards, quizzes, and exam sessions.

import { getDatabase } from "./database.js"
import { createDocumentId, createChunkId, createCardId, createQuizId, createExamId } from "../lib/branded-ids.js"
import type { StudyCard, Quiz, ExamSession, Question } from "../types.js"
import type { CardId, QuizId, ExamId, DocumentId } from "../lib/branded-ids.js"

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    console.warn("[mind-forge] Failed to parse JSON column in study-queries:", raw.slice(0, 80))
    return fallback
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Row Mapper
// ═══════════════════════════════════════════════════════════════════════════

function rowToStudyCard(row: Record<string, unknown>): StudyCard {
  return {
    id: createCardId(row.id as string),
    documentId: createDocumentId(row.document_id as string),
    chunkId: createChunkId(row.chunk_id as string),
    question: row.question as string,
    answer: row.answer as string,
    easeFactor: row.ease_factor as number,
    interval: row.interval as number,
    repetitions: row.repetitions as number,
    dueDate: new Date(row.due_date as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Study Card Queries
// ═══════════════════════════════════════════════════════════════════════════

export function insertStudyCard(row: {
  id: string
  documentId: string
  chunkId: string
  question: string
  answer: string
  easeFactor: number
  interval: number
  repetitions: number
  dueDate: string
  createdAt: string
}): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO study_cards (id, document_id, chunk_id, question, answer, ease_factor, interval, repetitions, due_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.documentId,
    row.chunkId,
    row.question,
    row.answer,
    row.easeFactor,
    row.interval,
    row.repetitions,
    row.dueDate,
    row.createdAt,
  )
}

export function getStudyCard(id: CardId): StudyCard | undefined {
  const db = getDatabase()
  const row = db.prepare("SELECT * FROM study_cards WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToStudyCard(row) : undefined
}

export function getStudyCardsByDocumentIds(documentIds: string[]): StudyCard[] {
  if (documentIds.length === 0) return []

  const db = getDatabase()
  const placeholders = documentIds.map(() => "?").join(",")
  const rows = db
    .prepare(
      `SELECT * FROM study_cards WHERE document_id IN (${placeholders}) ORDER BY RANDOM()`,
    )
    .all(...documentIds) as Record<string, unknown>[]
  return rows.map(rowToStudyCard)
}

export function getDueCards(limit?: number): StudyCard[] {
  const db = getDatabase()
  const now_ = new Date().toISOString()

  const params: (string | number)[] = [now_]
  let query = "SELECT * FROM study_cards WHERE due_date <= ? ORDER BY due_date ASC"
  if (limit !== undefined) {
    query += " LIMIT ?"
    params.push(limit)
  }

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[]
  return rows.map(rowToStudyCard)
}

export function updateStudyCardReview(
  id: CardId,
  easeFactor: number,
  interval: number,
  repetitions: number,
  dueDate: string,
): void {
  const db = getDatabase()
  db.prepare(
    `UPDATE study_cards
     SET ease_factor = ?, interval = ?, repetitions = ?, due_date = ?
     WHERE id = ?`,
  ).run(easeFactor, interval, repetitions, dueDate, id)
}

// ═══════════════════════════════════════════════════════════════════════════
// Quiz Queries
// ═══════════════════════════════════════════════════════════════════════════

export function insertQuiz(quiz: Quiz): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO quizzes (id, document_ids, questions, answer_keys, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    quiz.id,
    JSON.stringify(quiz.documentIds),
    JSON.stringify(quiz.questions),
    JSON.stringify(quiz.answerKeys),
    quiz.createdAt.toISOString(),
  )
}

export function getQuiz(id: QuizId): Quiz | undefined {
  const db = getDatabase()
  const row = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return undefined

  return {
    id: createQuizId(row.id as string),
    documentIds: safeJsonParse(row.document_ids as string, [] as string[]).map(createDocumentId),
    questions: safeJsonParse(row.questions as string, [] as Question[]),
    answerKeys: safeJsonParse(row.answer_keys as string, {} as Record<string, string>),
    createdAt: new Date(row.created_at as string),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Exam Session Queries
// ═══════════════════════════════════════════════════════════════════════════

export function insertExamSession(session: ExamSession): void {
  const db = getDatabase()
  db.prepare(
    `INSERT INTO exams (id, exam_id, started_at, answers)
     VALUES (?, ?, ?, ?)`,
  ).run(
    session.id,
    session.examId,
    session.startedAt.toISOString(),
    JSON.stringify(session.answers),
  )
}

export function upsertExamSession(id: string, examId: string, startedAt: string): void {
  const db = getDatabase()
  const existing = db.prepare("SELECT id FROM exams WHERE id = ?").get(id) as
    | { id: string }
    | undefined

  if (existing) {
    db.prepare("UPDATE exams SET started_at = ? WHERE id = ?").run(startedAt, id)
  } else {
    db.prepare(
      `INSERT INTO exams (id, exam_id, started_at, answers)
       VALUES (?, ?, ?, ?)`,
    ).run(id, examId, startedAt, "{}")
  }
}

export function getExamSessionByExamId(examId: ExamId): ExamSession | undefined {
  const db = getDatabase()
  const row = db.prepare("SELECT * FROM exams WHERE exam_id = ?").get(examId) as
    | Record<string, unknown>
    | undefined
  if (!row) return undefined

  return {
    id: createExamId(row.id as string),
    examId: createExamId(row.exam_id as string),
    startedAt: new Date(row.started_at as string),
    submittedAt: row.submitted_at ? new Date(row.submitted_at as string) : undefined,
    score: row.score as number | undefined,
    answers: safeJsonParse(row.answers as string, {} as Record<string, string>),
  }
}

export function updateExamSubmission(
  id: ExamId,
  score: number,
  submittedAt: string,
  answers: string,
): void {
  const db = getDatabase()
  db.prepare(
    `UPDATE exams SET submitted_at = ?, score = ?, answers = ? WHERE exam_id = ?`,
  ).run(submittedAt, score, answers, id)
}
