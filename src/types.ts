// ── Source Documents ───────────────────────────────────────────────────

export type DocumentFormat = "pdf" | "docx" | "md" | "image" | "url"

export interface SourceDocument {
  id: string
  filename: string
  format: DocumentFormat
  title: string
  author?: string
  text: string
  metadata: Record<string, unknown>
  ingestedAt: Date
}

// ── Document Chunks ────────────────────────────────────────────────────

export interface DocumentChunk {
  id: string
  documentId: string
  index: number
  content: string
  tokenCount: number
  embedding?: number[]
}

// ── Entities ───────────────────────────────────────────────────────────

export type EntityType = "concept" | "person" | "date" | "term" | "formula" | "definition"

export interface Entity {
  id: string
  label: string
  type: EntityType
  description: string
  chunkId: string
  metadata: Record<string, unknown>
}

// ── Relationships ──────────────────────────────────────────────────────

export type RelationshipType = "depends_on" | "part_of" | "defined_by" | "example_of"

export interface Relationship {
  id: string
  fromEntityId: string
  toEntityId: string
  type: RelationshipType
  chunkId: string
  confidence: number
}

// ── Study Cards ────────────────────────────────────────────────────────

export interface StudyCard {
  id: string
  documentId: string
  chunkId: string
  question: string
  answer: string
  easeFactor: number
  interval: number
  repetitions: number
  dueDate: Date
  createdAt: Date
}

// ── Quiz / Exam ────────────────────────────────────────────────────────

export type QuestionType = "multiple_choice" | "true_false" | "fill_blank" | "short_answer"

export interface Question {
  id: string
  type: QuestionType
  prompt: string
  options?: string[]
  answer: string
}

export interface Quiz {
  id: string
  documentIds: string[]
  questions: Question[]
  answerKeys: Record<string, string>
  createdAt: Date
}

export interface ExamSession {
  id: string
  examId: string
  startedAt: Date
  submittedAt?: Date
  score?: number
  answers: Record<string, string>
}

// ── Embedding ──────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
  health(): Promise<boolean>
}

// ── Search ─────────────────────────────────────────────────────────────

export interface SearchResult {
  chunk: DocumentChunk
  score: number
  source: SourceDocument
  entities?: Entity[]
  relationships?: Relationship[]
}

/** A study review session — cards due for review */
export interface StudyReview {
  id: string;
  documentId: string;
  cards: StudyCard[];
  dueCount: number;
  reviewedCount: number;
  sessionStartedAt: Date;
}
