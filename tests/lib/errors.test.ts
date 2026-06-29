import { describe, it, expect } from "vitest"
import {
  MindForgeError,
  ValidationError,
  DatabaseError,
  EmbeddingError,
  ExtractionError,
} from "../../src/lib/errors.js"

// ── Base Error ───────────────────────────────────────────────────────────

describe("MindForgeError", () => {
  it("should create an error with the given message", () => {
    const err = new MindForgeError("test message")
    expect(err.message).toBe("test message")
  })

  it("should set name to constructor name", () => {
    const err = new MindForgeError("test")
    expect(err.name).toBe("MindForgeError")
  })

  it("should be instance of Error", () => {
    const err = new MindForgeError("test")
    expect(err).toBeInstanceOf(Error)
  })

  it("should preserve an optional cause", () => {
    const cause = new Error("root cause")
    const err = new MindForgeError("wrapped", cause)
    expect(err.cause).toBe(cause)
  })

  it("should be undefined cause when not provided", () => {
    const err = new MindForgeError("test")
    expect(err.cause).toBeUndefined()
  })

  it("should have a stack trace", () => {
    const err = new MindForgeError("test")
    expect(err.stack).toBeDefined()
  })
})

// ── ValidationError ──────────────────────────────────────────────────────

describe("ValidationError", () => {
  it("should extend MindForgeError", () => {
    const err = new ValidationError("invalid input")
    expect(err).toBeInstanceOf(MindForgeError)
    expect(err).toBeInstanceOf(Error)
  })

  it("should set name to ValidationError", () => {
    const err = new ValidationError("invalid")
    expect(err.name).toBe("ValidationError")
  })

  it("should accept an optional cause", () => {
    const cause = new Error("parse failure")
    const err = new ValidationError("bad format", cause)
    expect(err.cause).toBe(cause)
    expect(err.message).toBe("bad format")
  })
})

// ── DatabaseError ────────────────────────────────────────────────────────

describe("DatabaseError", () => {
  it("should extend MindForgeError", () => {
    const err = new DatabaseError("connection failed")
    expect(err).toBeInstanceOf(MindForgeError)
  })

  it("should set name to DatabaseError", () => {
    const err = new DatabaseError("error")
    expect(err.name).toBe("DatabaseError")
  })

  it("should accept an optional cause", () => {
    const cause = new Error("SQL error")
    const err = new DatabaseError("query failed", cause)
    expect(err.cause).toBe(cause)
  })
})

// ── EmbeddingError ───────────────────────────────────────────────────────

describe("EmbeddingError", () => {
  it("should extend MindForgeError", () => {
    const err = new EmbeddingError("embedding failed")
    expect(err).toBeInstanceOf(MindForgeError)
  })

  it("should set name to EmbeddingError", () => {
    const err = new EmbeddingError("error")
    expect(err.name).toBe("EmbeddingError")
  })
})

// ── ExtractionError ──────────────────────────────────────────────────────

describe("ExtractionError", () => {
  it("should extend MindForgeError", () => {
    const err = new ExtractionError("extraction failed")
    expect(err).toBeInstanceOf(MindForgeError)
  })

  it("should set name to ExtractionError", () => {
    const err = new ExtractionError("error")
    expect(err.name).toBe("ExtractionError")
  })

  it("should accept an optional cause", () => {
    const cause = new Error("PDF corrupt")
    const err = new ExtractionError("cannot parse", cause)
    expect(err.cause).toBe(cause)
  })
})
