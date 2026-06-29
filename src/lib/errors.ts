// ── Error Hierarchy ───────────────────────────────────────────────────────
// All Mind Forge domain errors extend a common base for consistent
// error handling across the entire application.

export class MindForgeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = this.constructor.name
  }
}

export class ValidationError extends MindForgeError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class DatabaseError extends MindForgeError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class EmbeddingError extends MindForgeError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class ExtractionError extends MindForgeError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}
