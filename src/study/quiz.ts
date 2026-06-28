import type { Question, QuestionType, Quiz, StudyCard } from "../types.js"
import { getDatabase } from "../store/database.js"
import { randomUUID } from "node:crypto"

// ── Helpers ──────────────────────────────────────────────────────────────

function now(): Date {
  return new Date()
}

/**
 * Shuffle an array in place (Fisher-Yates) and return it.
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Pick `n` random items from an array (without replacement).
 */
function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr]
  shuffle(copy)
  return copy.slice(0, Math.min(n, copy.length))
}

// ── Question Generators ──────────────────────────────────────────────────

/**
 * Generate a multiple-choice question from a card.
 */
function generateMCQ(card: StudyCard, allCards: StudyCard[]): Question {
  const id = randomUUID()

  // Use the answer as the correct option
  const correct = card.answer

  // Pick distractors from other cards' answers
  const others = allCards
    .filter((c) => c.id !== card.id && c.answer !== correct)
    .map((c) => c.answer)

  // Remove duplicates
  const uniqueOthers = [...new Set(others)]

  // Pick up to 3 distractors
  const distractors = pickRandom(uniqueOthers, 3)

  // Ensure we have exactly 3 distractors by padding with generic ones
  while (distractors.length < 3) {
    distractors.push(`None of the above`)
  }

  const options = shuffle([correct, ...distractors])

  return {
    id,
    type: "multiple_choice",
    prompt: card.question,
    options,
    answer: correct,
  }
}

/**
 * Generate a true/false question from a card.
 */
function generateTrueFalse(card: StudyCard): Question {
  const id = randomUUID()

  // 50% chance of true statement, 50% false
  const isTrue = Math.random() < 0.5

  if (isTrue) {
    return {
      id,
      type: "true_false",
      prompt: `True or false: ${card.answer}`,
      options: ["true", "false"],
      answer: "true",
    }
  } else {
    // Create a plausible but incorrect statement by negating or modifying
    const negated = negateStatement(card.answer)
    return {
      id,
      type: "true_false",
      prompt: `True or false: ${negated}`,
      options: ["true", "false"],
      answer: "false",
    }
  }
}

/**
 * Simple statement negation for true/false generation.
 */
function negateStatement(statement: string): string {
  const negations: Array<[RegExp, string]> = [
    [/ is not /i, " is "],
    [/ is /i, " is not "],
    [/ are not /i, " are "],
    [/ are /i, " are not "],
    [/ occurs during /i, " occurs outside of "],
    [/ involves /i, " does not involve "],
  ]

  for (const [pattern, replacement] of negations) {
    if (pattern.test(statement)) {
      return statement.replace(pattern, replacement)
    }
  }

  // Fallback: prepend "It is not true that "
  return `It is not true that ${statement.slice(0, 1).toLowerCase()}${statement.slice(1)}`
}

/**
 * Generate a fill-in-blank question from a card.
 */
function generateFillBlank(card: StudyCard): Question {
  const id = randomUUID()
  const answer = card.answer

  // Extract the first key noun phrase from the answer
  const words = answer.split(/\s+/)
  const skipWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "of", "in", "on",
    "at", "to", "for", "with", "by", "from", "it", "its", "this", "that",
  ])

  // Find the first content word to blank
  let blankIdx = -1
  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[^a-zA-Z0-9-]/g, "")
    if (word.length >= 4 && !skipWords.has(word.toLowerCase())) {
      blankIdx = i
      break
    }
  }

  if (blankIdx === -1) {
    blankIdx = Math.min(2, words.length - 1)
  }

  const blankWord = words[blankIdx].replace(/[^a-zA-Z0-9-]/g, "")
  const promptWords = [...words]
  promptWords[blankIdx] = "______"

  return {
    id,
    type: "fill_blank",
    prompt: `Fill in the blank: ${promptWords.join(" ")}`,
    answer: blankWord,
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Generate a quiz from study cards extracted from the given documents.
 *
 * @param documentIds - Documents to generate questions from
 * @param count - Number of questions (default: 5)
 * @param types - Allowed question types (default: all types)
 */
export function generateQuiz(
  documentIds: string[],
  count: number = 5,
  types?: QuestionType[],
): Quiz {
  const db = getDatabase()

  // Get cards for the specified documents
  const placeholders = documentIds.map(() => "?").join(",")
  const cards = db
    .prepare(
      `SELECT * FROM study_cards WHERE document_id IN (${placeholders}) ORDER BY RANDOM()`,
    )
    .all(...documentIds) as (Record<string, unknown> & { answer: string })[]

  if (cards.length === 0) {
    throw new Error(
      `No study cards found for documents: ${documentIds.join(", ")}`,
    )
  }

  // Convert to StudyCard objects
  const studyCards: StudyCard[] = cards.map(rowToStudyCard)

  // Determine which question types to use
  const allowedTypes: QuestionType[] = types ?? [
    "multiple_choice",
    "true_false",
    "fill_blank",
  ]

  // Generate questions by cycling through types
  const questions: Question[] = []
  const answerKeys: Record<string, string> = {}

  const selectedCards = pickRandom(studyCards, count)

  for (let i = 0; i < selectedCards.length; i++) {
    const card = selectedCards[i]
    const type = allowedTypes[i % allowedTypes.length]
    let question: Question

    switch (type) {
      case "multiple_choice":
        question = generateMCQ(card, studyCards)
        break
      case "true_false":
        question = generateTrueFalse(card)
        break
      case "fill_blank":
        question = generateFillBlank(card)
        break
      default:
        question = generateMCQ(card, studyCards)
    }

    questions.push(question)
    answerKeys[question.id] = question.answer
  }

  const quiz: Quiz = {
    id: randomUUID(),
    documentIds,
    questions,
    answerKeys,
    createdAt: now(),
  }

  // Persist to database
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

  return quiz
}

/**
 * Grade a quiz against stored answer keys.
 */
export function gradeQuiz(
  quizId: string,
  answers: Record<string, string>,
): {
  total: number
  correct: number
  score: number
  details: Array<{ questionId: string; correct: boolean; yourAnswer: string; correctAnswer: string }>
} {
  const db = getDatabase()

  const row = db.prepare("SELECT * FROM quizzes WHERE id = ?").get(quizId) as
    | Record<string, unknown>
    | undefined

  if (!row) {
    throw new Error(`Quiz not found: ${quizId}`)
  }

  const answerKeys: Record<string, string> = JSON.parse(row.answer_keys as string)
  const questions: Question[] = JSON.parse(row.questions as string)

  const details: Array<{
    questionId: string
    correct: boolean
    yourAnswer: string
    correctAnswer: string
  }> = []

  let correctCount = 0

  for (const question of questions) {
    const userAnswer = (answers[question.id] ?? "").trim()
    const correctAnswer = answerKeys[question.id]

    let isCorrect: boolean
    if (question.type === "fill_blank") {
      // Case-insensitive comparison for fill-blank
      isCorrect = userAnswer.toLowerCase() === correctAnswer.toLowerCase()
    } else {
      isCorrect = userAnswer === correctAnswer
    }

    if (isCorrect) correctCount++

    details.push({
      questionId: question.id,
      correct: isCorrect,
      yourAnswer: userAnswer,
      correctAnswer,
    })
  }

  return {
    total: questions.length,
    correct: correctCount,
    score: Math.round((correctCount / questions.length) * 100),
    details,
  }
}

// ── Row mapping ──────────────────────────────────────────────────────────

function rowToStudyCard(row: Record<string, unknown>): StudyCard {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    chunkId: row.chunk_id as string,
    question: row.question as string,
    answer: row.answer as string,
    easeFactor: row.ease_factor as number,
    interval: row.interval as number,
    repetitions: row.repetitions as number,
    dueDate: new Date(row.due_date as string),
    createdAt: new Date(row.created_at as string),
  }
}
