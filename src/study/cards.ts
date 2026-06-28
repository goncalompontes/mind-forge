import type { DocumentChunk, StudyCard } from "../types.js"
import { getDatabase } from "../store/database.js"
import { randomUUID } from "node:crypto"

// ── Helpers ──────────────────────────────────────────────────────────────

function now(): Date {
  return new Date()
}

function daysFromNow(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d
}

/**
 * Simple template-based card creation from key sentences/phrases.
 * For MVP: finds definition patterns like "X is..." and creates Q/A cards.
 */
function generateCardsFromChunk(chunk: DocumentChunk): Array<{ question: string; answer: string }> {
  const results: Array<{ question: string; answer: string }> = []
  const content = chunk.content

  // Pattern 1: "X is..." / "X are..." definition sentences
  const definitionPattern = /([A-Z][a-z]+(?:\s+[a-z]+){0,5})\s+(?:is|are)\s+([^.!?]+[.!?])/g
  let match: RegExpExecArray | null
  while ((match = definitionPattern.exec(content)) !== null) {
    const subject = match[1].trim()
    const definition = `${subject} is ${match[2].trim()}`
    results.push({
      question: `What is ${subject}?`,
      answer: definition,
    })
  }

  // Pattern 2: "X occurs..." / "X happens..." / "X involves..." process sentences
  const processPattern = /([A-Z][a-z]+(?:\s+[a-z]+){0,4})\s+(?:occurs|happens|involves|uses|produces|contains)\s+([^.!?]+[.!?])/g
  while ((match = processPattern.exec(content)) !== null) {
    const subject = match[1].trim()
    results.push({
      question: `What does "${subject}" involve?`,
      answer: match[0].trim(),
    })
  }

  // Pattern 3: Extract key-terms in quotes or emphasized
  const quotedPattern = /["""]((?:[^"""]+))["""]\s+(?:is|refers to|means)\s+([^.!?]+[.!?])/g
  while ((match = quotedPattern.exec(content)) !== null) {
    results.push({
      question: `What is "${match[1].trim()}"?`,
      answer: match[0].trim(),
    })
  }

  // Fallback: create a fill-in-the-blank card from the first sentence
  if (results.length === 0) {
    const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 10)
    if (sentences.length > 0) {
      const sentence = sentences[0].trim()
      const words = sentence.split(/\s+/)
      if (words.length >= 5) {
        // Blank the most meaningful word (first noun-like word after position 2)
        const blankIdx = Math.min(
          Math.max(2, Math.floor(words.length / 3)),
          words.length - 2,
        )
        const question = [
          ...words.slice(0, blankIdx),
          "______",
          ...words.slice(blankIdx + 1),
        ].join(" ")
        results.push({
          question: `Fill in the blank: ${question}`,
          answer: words[blankIdx].replace(/[^a-zA-Z-]/g, ""),
        })
      }
    }
  }

  return results
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

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Create study cards from document chunks using template-based extraction.
 * Cards are persisted to the database.
 */
export function createCards(documentId: string, chunks: DocumentChunk[]): StudyCard[] {
  const db = getDatabase()
  const cards: StudyCard[] = []
  const now_ = now()

  const stmt = db.prepare(
    `INSERT INTO study_cards (id, document_id, chunk_id, question, answer, ease_factor, interval, repetitions, due_date, created_at)
     VALUES (?, ?, ?, ?, ?, 2.5, 0, 0, ?, ?)`,
  )

  const insertMany = db.transaction(() => {
    for (const chunk of chunks) {
      const entries = generateCardsFromChunk(chunk)
      for (const entry of entries) {
        const id = randomUUID()
        const dueDate = now_.toISOString()
        const createdAt = now_.toISOString()
        stmt.run(id, documentId, chunk.id, entry.question, entry.answer, dueDate, createdAt)
        cards.push({
          id,
          documentId,
          chunkId: chunk.id,
          question: entry.question,
          answer: entry.answer,
          easeFactor: 2.5,
          interval: 0,
          repetitions: 0,
          dueDate: new Date(dueDate),
          createdAt: new Date(createdAt),
        })
      }
    }
  })

  insertMany()
  return cards
}

/**
 * SM-2 scheduling algorithm.
 * Updates a card's easeFactor, interval, repetitions and dueDate based on review quality (0-5).
 */
export function scheduleReview(cardId: string, quality: number): void {
  const db = getDatabase()
  const row = db.prepare("SELECT * FROM study_cards WHERE id = ?").get(cardId) as
    | Record<string, unknown>
    | undefined

  if (!row) {
    throw new Error(`Study card not found: ${cardId}`)
  }

  let repetitions = row.repetitions as number
  let interval = row.interval as number
  let easeFactor = row.ease_factor as number

  if (quality < 3) {
    // Failed recall: reset
    repetitions = 0
    interval = 1
  } else {
    // Successful recall
    if (repetitions === 0) {
      interval = 1
    } else if (repetitions === 1) {
      interval = 6
    } else {
      interval = Math.round(interval * easeFactor)
    }
    repetitions += 1
  }

  // Update easeFactor
  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))

  // Clamp easeFactor to minimum 1.3
  if (easeFactor < 1.3) {
    easeFactor = 1.3
  }

  const dueDate = daysFromNow(interval)

  db.prepare(
    `UPDATE study_cards 
     SET ease_factor = ?, interval = ?, repetitions = ?, due_date = ?
     WHERE id = ?`,
  ).run(easeFactor, interval, repetitions, dueDate.toISOString(), cardId)
}

/**
 * Get cards that are due for review.
 */
export function getDueCards(limit?: number): StudyCard[] {
  const db = getDatabase()
  const now_ = now().toISOString()

  const params: (string | number)[] = [now_]
  let query = "SELECT * FROM study_cards WHERE due_date <= ? ORDER BY due_date ASC"
  if (limit !== undefined) {
    query += " LIMIT ?"
    params.push(limit)
  }

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[]
  return rows.map(rowToStudyCard)
}


