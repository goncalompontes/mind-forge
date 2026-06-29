import { describe, it, expect } from "vitest"
import {
  type DocumentId,
  type ChunkId,
  type EntityId,
  type RelationshipId,
  type CardId,
  type QuizId,
  type ExamId,
  createDocumentId,
  createChunkId,
  createEntityId,
  createRelationshipId,
  createCardId,
  createQuizId,
  createExamId,
} from "../../src/lib/branded-ids.js"

describe("branded IDs", () => {
  it("createDocumentId returns a string that is a DocumentId", () => {
    const id = createDocumentId("doc-123")
    expect(typeof id).toBe("string")
    expect(id).toBe("doc-123")
  })

  it("createChunkId returns a string that is a ChunkId", () => {
    const id = createChunkId("chunk-456")
    expect(typeof id).toBe("string")
    expect(id).toBe("chunk-456")
  })

  it("createEntityId returns a string that is an EntityId", () => {
    const id = createEntityId("ent-789")
    expect(typeof id).toBe("string")
    expect(id).toBe("ent-789")
  })

  it("createRelationshipId returns a string that is a RelationshipId", () => {
    const id = createRelationshipId("rel-abc")
    expect(typeof id).toBe("string")
    expect(id).toBe("rel-abc")
  })

  it("createCardId returns a string that is a CardId", () => {
    const id = createCardId("card-def")
    expect(typeof id).toBe("string")
    expect(id).toBe("card-def")
  })

  it("createQuizId returns a string that is a QuizId", () => {
    const id = createQuizId("quiz-ghi")
    expect(typeof id).toBe("string")
    expect(id).toBe("quiz-ghi")
  })

  it("createExamId returns a string that is an ExamId", () => {
    const id = createExamId("exam-jkl")
    expect(typeof id).toBe("string")
    expect(id).toBe("exam-jkl")
  })

  it("branded IDs are assignable to string (covariant)", () => {
    const docId: DocumentId = createDocumentId("x")
    const str: string = docId
    expect(str).toBe("x")
  })

  it("helpers accept empty strings", () => {
    expect(createDocumentId("")).toBe("")
  })

  it("helpers accept UUID-format strings", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000"
    expect(createDocumentId(uuid)).toBe(uuid)
  })
})
