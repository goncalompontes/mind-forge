import type { Question, QuestionType } from "../types.js"
import { getDatabase } from "../store/database.js"
import { generateQuiz, gradeQuiz } from "./quiz.js"
import { randomUUID } from "node:crypto"

// ── Types ────────────────────────────────────────────────────────────────

export interface ExamConfig {
  questionCount: number
  durationMinutes: number
  types?: QuestionType[]
}

export interface Exam {
  id: string
  documentIds: string[]
  questions: Question[]
  answerKeys: Record<string, string>
  config: ExamConfig
  startedAt?: Date
  submittedAt?: Date
}

export interface ExamResult {
  id: string
  score: number
  total: number
  correct: number
  timeTaken: number // in seconds
  startedAt: Date
  submittedAt: Date
  details: Array<{
    questionId: string
    correct: boolean
    yourAnswer: string
    correctAnswer: string
  }>
}

// ── Helpers ──────────────────────────────────────────────────────────────

function now(): Date {
  return new Date()
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Create an exam with a set of quiz questions and timer config.
 */
export function createExam(
  documentIds: string[],
  config: ExamConfig,
): Exam {
  // Generate quiz questions using the quiz module
  const quiz = generateQuiz(documentIds, config.questionCount, config.types)

  const exam: Exam = {
    id: quiz.id, // Reuse quiz ID as exam ID
    documentIds,
    questions: quiz.questions,
    answerKeys: quiz.answerKeys,
    config,
  }

  return exam
}

/**
 * Start an exam — records the start time.
 */
export function startExam(examId: string): { startedAt: Date } {
  const db = getDatabase()

  const row = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(examId) as
    | Record<string, unknown>
    | undefined

  if (!row) {
    throw new Error(`Exam not found: ${examId}`)
  }

  const startedAt = now()

  // Update or insert exam session
  const existing = db.prepare("SELECT * FROM exams WHERE id = ?").get(examId) as
    | Record<string, unknown>
    | undefined

  if (existing) {
    db.prepare("UPDATE exams SET started_at = ? WHERE id = ?").run(
      startedAt.toISOString(),
      examId,
    )
  } else {
    db.prepare(
      `INSERT INTO exams (id, exam_id, started_at, answers)
       VALUES (?, ?, ?, ?)`,
    ).run(randomUUID(), examId, startedAt.toISOString(), "{}")
  }

  return { startedAt }
}

/**
 * Submit an exam — auto-grade, compute score percentage.
 */
export function submitExam(
  examId: string,
  answers: Record<string, string>,
): {
  score: number
  total: number
  correct: number
  submittedAt: Date
} {
  const db = getDatabase()

  // Check exam exists
  const quizRow = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(examId) as
    | Record<string, unknown>
    | undefined

  if (!quizRow) {
    throw new Error(`Exam not found: ${examId}`)
  }

  // Check exam has been started
  const examRow = db.prepare("SELECT * FROM exams WHERE exam_id = ?").get(examId) as
    | Record<string, unknown>
    | undefined

  if (!examRow || !examRow.started_at) {
    throw new Error(`Exam has not been started: ${examId}`)
  }

  // Grade the quiz
  const result = gradeQuiz(examId, answers)

  const submittedAt = now()

  // Persist submission
  db.prepare(
    `UPDATE exams SET submitted_at = ?, score = ?, answers = ? WHERE exam_id = ?`,
  ).run(
    submittedAt.toISOString(),
    result.score,
    JSON.stringify(answers),
    examId,
  )

  return {
    score: result.score,
    total: result.total,
    correct: result.correct,
    submittedAt,
  }
}

/**
 * Get full exam result with score, time taken, and per-question results.
 */
export function getExamResult(
  examId: string,
): ExamResult {
  const db = getDatabase()

  const quizRow = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(examId) as
    | Record<string, unknown>
    | undefined

  if (!quizRow) {
    throw new Error(`Exam not found: ${examId}`)
  }

  const examRow = db.prepare("SELECT * FROM exams WHERE exam_id = ?").get(examId) as
    | Record<string, unknown>
    | undefined

  if (!examRow) {
    throw new Error(`Exam not found: ${examId}`)
  }

  if (!examRow.submitted_at) {
    throw new Error(`Exam has not been submitted yet: ${examId}`)
  }

  const startedAt = new Date(examRow.started_at as string)
  const submittedAt = new Date(examRow.submitted_at as string)
  const timeTaken = Math.round(
    (submittedAt.getTime() - startedAt.getTime()) / 1000,
  )

  const result = gradeQuiz(examId, JSON.parse(examRow.answers as string))

  return {
    id: examId,
    score: result.score,
    total: result.total,
    correct: result.correct,
    timeTaken,
    startedAt,
    submittedAt,
    details: result.details,
  }
}
