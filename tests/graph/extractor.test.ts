import { describe, it, expect } from "vitest"
import { extractEntitiesAndRelationships } from "../../src/graph/extractor.js"
import type { DocumentChunk } from "../../src/types.js"

describe("extractEntitiesAndRelationships", () => {
  // ── Entity Extraction ─────────────────────────────────────────────────

  it("should extract capitalized multi-word terms as entities", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c1",
        documentId: "d1",
        index: 0,
        content: "Machine Learning is a subset of Artificial Intelligence.",
        tokenCount: 8,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const labels = result.entities.map((e) => e.label)
    expect(labels).toContain("Machine Learning")
    expect(labels).toContain("Artificial Intelligence")
  })

  it("should classify definition-entity from 'is a' patterns", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c2",
        documentId: "d1",
        index: 0,
        content: "A Monad is a design pattern used in functional programming.",
        tokenCount: 12,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const monad = result.entities.find((e) => e.label === "Monad")
    expect(monad).toBeDefined()
    expect(monad!.type).toBe("definition")
    expect(monad!.description).toContain("design pattern")
  })

  it("should classify definition from 'refers to' patterns", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c3",
        documentId: "d1",
        index: 0,
        content: "Entropy refers to the measure of disorder in a system.",
        tokenCount: 12,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const entropy = result.entities.find((e) => e.label === "Entropy")
    expect(entropy).toBeDefined()
    expect(entropy!.type).toBe("definition")
  })

  it("should extract potential date entities", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c4",
        documentId: "d1",
        index: 0,
        content: "The Treaty of Westphalia was signed in 1648.",
        tokenCount: 10,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const date = result.entities.find((e) => e.label === "1648")
    expect(date).toBeDefined()
    expect(date!.type).toBe("date")
  })

  it("should detect formula-like content", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c5",
        documentId: "d1",
        index: 0,
        content: "Einstein's equation E = mc^2 describes mass-energy equivalence.",
        tokenCount: 10,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const formulas = result.entities.filter((e) => e.type === "formula")
    expect(formulas.length).toBeGreaterThanOrEqual(1)
  })

  it("should extract single capitalized terms (not stop words) as entities", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c6",
        documentId: "d1",
        index: 0,
        content: "The study of Semantics is crucial for NLP.",
        tokenCount: 10,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const labels = result.entities.map((e) => e.label)
    expect(labels).toContain("Semantics")
    expect(labels).toContain("NLP")
  })

  it("should filter out common stop words from entity extraction", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c7",
        documentId: "d1",
        index: 0,
        content: "This is a test. However, we should check The Result.",
        tokenCount: 12,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const labels = result.entities.map((e) => e.label)
    expect(labels).not.toContain("This")
    expect(labels).not.toContain("However")
    expect(labels).not.toContain("The")
  })

  it("should deduplicate entities with the same label", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c8",
        documentId: "d1",
        index: 0,
        content: "Machine Learning is powerful. Machine Learning requires data.",
        tokenCount: 10,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const mlEntities = result.entities.filter((e) => e.label === "Machine Learning")
    expect(mlEntities.length).toBe(1)
  })

  // ── Relationship Extraction ───────────────────────────────────────────

  it("should create relationships from co-occurrence within a chunk", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c9",
        documentId: "d1",
        index: 0,
        content: "Machine Learning and Artificial Intelligence are related fields.",
        tokenCount: 10,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const mlEntity = result.entities.find((e) => e.label === "Machine Learning")
    const aiEntity = result.entities.find((e) => e.label === "Artificial Intelligence")
    expect(mlEntity).toBeDefined()
    expect(aiEntity).toBeDefined()

    const rel = result.relationships.find(
      (r) =>
        (r.fromEntityId === mlEntity!.id && r.toEntityId === aiEntity!.id) ||
        (r.fromEntityId === aiEntity!.id && r.toEntityId === mlEntity!.id),
    )
    expect(rel).toBeDefined()
  })

  it("should detect 'depends_on' relationship from depends-on patterns", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c10",
        documentId: "d1",
        index: 0,
        content: "React depends on the Virtual DOM for rendering performance.",
        tokenCount: 10,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const react = result.entities.find((e) => e.label === "React")
    const vdom = result.entities.find((e) => e.label === "Virtual DOM")
    expect(react).toBeDefined()
    expect(vdom).toBeDefined()

    const dependsRel = result.relationships.find(
      (r) => r.type === "depends_on" && r.fromEntityId === react?.id && r.toEntityId === vdom?.id,
    )
    expect(dependsRel).toBeDefined()
  })

  it("should detect 'part_of' relationship from part-of patterns", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c11",
        documentId: "d1",
        index: 0,
        content: "The CPU is part of the Computer Architecture.",
        tokenCount: 10,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const cpu = result.entities.find((e) => e.label === "CPU")
    const ca = result.entities.find((e) => e.label === "Computer Architecture")
    expect(cpu).toBeDefined()
    expect(ca).toBeDefined()

    const partOfRel = result.relationships.find(
      (r) => r.type === "part_of" && r.fromEntityId === cpu?.id && r.toEntityId === ca?.id,
    )
    expect(partOfRel).toBeDefined()
  })

  it("should detect 'example_of' relationship from example patterns", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c12",
        documentId: "d1",
        index: 0,
        content: "Python is an example of a High-Level Language.",
        tokenCount: 10,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const python = result.entities.find((e) => e.label === "Python")
    const hll = result.entities.find((e) => e.label === "High-Level Language")
    expect(python).toBeDefined()
    expect(hll).toBeDefined()

    const exampleRel = result.relationships.find(
      (r) => r.type === "example_of" && r.fromEntityId === python?.id && r.toEntityId === hll?.id,
    )
    expect(exampleRel).toBeDefined()
  })

  it("should detect 'defined_by' relationship from definition patterns", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c13",
        documentId: "d1",
        index: 0,
        content: "A Monad is defined as a type of Functor.",
        tokenCount: 10,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)

    const monad = result.entities.find((e) => e.label === "Monad")
    const functor = result.entities.find((e) => e.label === "Functor")
    expect(monad).toBeDefined()
    expect(functor).toBeDefined()

    const definedByRel = result.relationships.find(
      (r) => r.type === "defined_by" && r.fromEntityId === monad?.id && r.toEntityId === functor?.id,
    )
    expect(definedByRel).toBeDefined()
  })

  // ── Edge Cases ────────────────────────────────────────────────────────

  it("should handle empty chunks array", async () => {
    const result = await extractEntitiesAndRelationships([])
    expect(result.entities).toEqual([])
    expect(result.relationships).toEqual([])
  })

  it("should handle chunks with no recognizable entities", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c14",
        documentId: "d1",
        index: 0,
        content: "this is all lowercase with no entities to extract",
        tokenCount: 10,
      },
    ]

    const result = await extractEntitiesAndRelationships(chunks)
    expect(result.entities.length).toBe(0)
    expect(result.relationships.length).toBe(0)
  })

  it("should support LLM callback extension point", async () => {
    const chunks: DocumentChunk[] = [
      {
        id: "c15",
        documentId: "d1",
        index: 0,
        content: "Custom entity from LLM.",
        tokenCount: 5,
      },
    ]

    const llmCallback = async (
      _chunks: DocumentChunk[],
    ): Promise<{ entities: import("../../src/types.js").Entity[]; relationships: import("../../src/types.js").Relationship[] }> => {
      return {
        entities: [
          {
            id: "llm-entity-1",
            label: "LLM-Discovered",
            type: "concept",
            description: "Discovered via LLM callback",
            chunkId: "c15",
            metadata: {},
          },
        ],
        relationships: [],
      }
    }

    const result = await extractEntitiesAndRelationships(chunks, { llmCallback })

    expect(result.entities.find((e) => e.id === "llm-entity-1")).toBeDefined()
    expect(result.entities.find((e) => e.label === "LLM-Discovered")?.description).toBe(
      "Discovered via LLM callback",
    )
  })
})
