// ── Branded ID Types ─────────────────────────────────────────────────────
// Each branded type is a string with a unique brand that prevents mixing IDs
// at the type level while maintaining zero runtime overhead.

export type DocumentId = string & { readonly __brand: "DocumentId" }
export type ChunkId = string & { readonly __brand: "ChunkId" }
export type EntityId = string & { readonly __brand: "EntityId" }
export type RelationshipId = string & { readonly __brand: "RelationshipId" }
export type CardId = string & { readonly __brand: "CardId" }
export type QuizId = string & { readonly __brand: "QuizId" }
export type ExamId = string & { readonly __brand: "ExamId" }

// ── Helper Functions ─────────────────────────────────────────────────────

export function createDocumentId(id: string): DocumentId {
  return id as DocumentId
}

export function createChunkId(id: string): ChunkId {
  return id as ChunkId
}

export function createEntityId(id: string): EntityId {
  return id as EntityId
}

export function createRelationshipId(id: string): RelationshipId {
  return id as RelationshipId
}

export function createCardId(id: string): CardId {
  return id as CardId
}

export function createQuizId(id: string): QuizId {
  return id as QuizId
}

export function createExamId(id: string): ExamId {
  return id as ExamId
}
