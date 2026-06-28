// ── Hybrid Query Tool: Vector + Graph + FTS5 ───────────────────────────────

import type {
  SearchResult,
  EmbeddingProvider,
  Entity,
  Relationship,
  RelationshipType,
} from "../types.js"
import { createEmbeddingProvider } from "../embed/provider.js"
import { searchSimilar } from "../store/vectors.js"
import { searchEntities, getNeighbors, getEntity } from "../graph/query.js"
import { getOrInitDatabase, getDatabase } from "../store/database.js"

// ── Types ──────────────────────────────────────────────────────────────────

export interface QueryFilters {
  documentIds?: string[]
  entityTypes?: string[]
  limit?: number
  minScore?: number
}

export interface QueryInput {
  query: string
  filters?: QueryFilters
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 10
const DEFAULT_MIN_SCORE = 0.0
const VECTOR_WEIGHT = 0.7
const FTS_WEIGHT = 0.3
const GRAPH_DEPTH = 1

// ── QueryTool ──────────────────────────────────────────────────────────────

export class QueryTool {
  private embedProvider: EmbeddingProvider

  /**
   * @param dbPath        Path to the SQLite database (or ":memory:")
   * @param embedConfig   Optional config passed to createEmbeddingProvider
   * @param embedProvider Optional pre-built provider (used by tests to inject mocks)
   */
  constructor(
    dbPath: string,
    embedConfig?: Record<string, unknown>,
    embedProvider?: EmbeddingProvider,
  ) {
    getOrInitDatabase(dbPath)
    this.embedProvider = embedProvider ?? createEmbeddingProvider(embedConfig as Parameters<typeof createEmbeddingProvider>[0])
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Execute a hybrid search across vector, graph, and full-text indexes.
   * 1. Vector similarity search (semantic)
   * 2. Graph-aware enrichment (entities + relationships)
   * 3. Full-text search (FTS5) fallback
   * 4. Merge with weighted ranking: vector * 0.7 + fts * 0.3
   */
  async execute(input: QueryInput): Promise<SearchResult[]> {
    const { query } = input
    const filters = input.filters ?? {}
    const limit = filters.limit ?? DEFAULT_LIMIT
    const minScore = filters.minScore ?? DEFAULT_MIN_SCORE

    if (!query || query.trim().length === 0) {
      return []
    }

    // Step 1: Vector (semantic) search
    const vectorResults = await this.vectorSearch(query, limit, filters)

    // Step 2: Graph-aware enrichment
    const graphEnriched = this.enrichWithGraph(vectorResults, query, filters)

    // Step 3: Full-text search
    const ftsResults = this.ftsSearch(query, limit, filters)

    // Step 4: Hybrid merge with weighted ranking
    return this.mergeHybridResults(graphEnriched, ftsResults, limit, minScore)
  }

  // ── Step 1: Vector Search ────────────────────────────────────────────────

  private async vectorSearch(
    query: string,
    limit: number,
    filters: QueryFilters,
  ): Promise<SearchResult[]> {
    let embeddings: number[][]
    try {
      embeddings = await this.embedProvider.embed([query])
    } catch {
      return []
    }

    const queryVector = embeddings[0]

    // searchSimilar accepts a single documentId via VectorSearchFilters
    const results = searchSimilar(queryVector, limit, {
      documentId: filters.documentIds?.[0],
    })

    // Convert distance (lower = better) → similarity (higher = better, 0-1 range)
    return results.map((r) => ({
      ...r,
      score: 1 / (1 + r.score),
    }))
  }

  // ── Step 2: Graph-Aware Enrichment ───────────────────────────────────────

  private enrichWithGraph(
    results: SearchResult[],
    query: string,
    filters: QueryFilters,
  ): SearchResult[] {
    // Extract candidate entity labels from the query text
    const words = query.split(/\s+/).filter((w) => w.length > 1)
    const matchedEntityIds = new Set<string>()

    for (const word of words) {
      const matches = searchEntities(word)
      for (const entity of matches) {
        // Apply entity type filter if specified
        if (filters.entityTypes && !filters.entityTypes.includes(entity.type)) {
          continue
        }
        matchedEntityIds.add(entity.id)
      }
    }

    if (matchedEntityIds.size === 0) return results

    // Gather matched entities, their neighbors, and relationships
    const entityMap = new Map<string, Entity>()
    const relationshipSet = new Set<string>()
    const relationships: Relationship[] = []

    for (const entityId of matchedEntityIds) {
      // Include the matched entity itself
      const self = getEntity(entityId)
      if (self) {
        entityMap.set(self.id, self)
      }

      // Include neighbors (entities connected via relationships)
      const neighbors = getNeighbors(entityId, GRAPH_DEPTH)
      for (const n of neighbors) {
        entityMap.set(n.id, n)
      }

      // Fetch relationships for this entity
      const relRows = getDatabase()
        .prepare(
          `SELECT * FROM relationships WHERE from_entity_id = ? OR to_entity_id = ?`,
        )
        .all(entityId, entityId) as Record<string, unknown>[]

      for (const row of relRows) {
        const relId = String(row.id)
        if (relationshipSet.has(relId)) continue
        relationshipSet.add(relId)

        relationships.push({
          id: relId,
          fromEntityId: String(row.from_entity_id),
          toEntityId: String(row.to_entity_id),
          type: String(row.type) as RelationshipType,
          chunkId: String(row.chunk_id),
          confidence: Number(row.confidence),
        })
      }
    }

    if (entityMap.size === 0) return results

    const allEntities = [...entityMap.values()]

    // Enrich each vector result with matching entities/relationships
    return results.map((result) => {
      const chunkEntities = allEntities.filter(
        (e) => e.chunkId === result.chunk.id,
      )
      const chunkRelationships = relationships.filter(
        (r) => r.chunkId === result.chunk.id,
      )

      if (chunkEntities.length === 0 && chunkRelationships.length === 0) {
        return result
      }

      return {
        ...result,
        entities: [...(result.entities ?? []), ...chunkEntities],
        relationships: [
          ...(result.relationships ?? []),
          ...chunkRelationships,
        ],
      }
    })
  }

  // ── Step 3: Full-Text Search ─────────────────────────────────────────────

  private ftsSearch(
    query: string,
    limit: number,
    filters: QueryFilters,
  ): SearchResult[] {
    const db = getDatabase()

    // Ensure FTS5 table has all current chunk data
    this.syncFTS()

    // Build an FTS5 query from the natural language query
    const ftsQuery = this.buildFTSQuery(query)
    if (!ftsQuery) return []

    const escapedQuery = ftsQuery.replace(/'/g, "''")

    // Build the WHERE clause with optional document filter
    let whereClause = `chunks_fts MATCH '${escapedQuery}'`
    const params: unknown[] = []

    if (filters.documentIds && filters.documentIds.length > 0) {
      const placeholders = filters.documentIds.map(() => "?").join(",")
      whereClause += ` AND d.id IN (${placeholders})`
      params.push(...filters.documentIds)
    }

    params.push(limit)

    const sql = `
      SELECT f.rowid, f.chunk_id, rank AS fts_score,
             c.id AS chunk_id, c.document_id, c.chunk_index, c.content, c.token_count,
             d.id AS doc_id, d.filename, d.format, d.title, d.author, d.text, d.metadata, d.ingested_at
      FROM chunks_fts f
      JOIN chunks c ON c.id = f.chunk_id
      JOIN documents d ON d.id = c.document_id
      WHERE ${whereClause}
      ORDER BY rank
      LIMIT ?
    `

    let rows: Record<string, unknown>[]
    try {
      rows = db.prepare(sql).all(...params) as Record<string, unknown>[]
    } catch {
      return []
    }

    if (rows.length === 0) return []

    // Normalise FTS BM25 scores (negative = better) to 0-1 range
    const rawScores = rows.map((r) => -(r.fts_score as number))
    const maxScore = Math.max(...rawScores, Number.EPSILON)
    const minScore = Math.min(...rawScores, 0)
    const range = maxScore - minScore

    return rows.map((row, i) => ({
      chunk: {
        id: String(row.chunk_id),
        documentId: String(row.document_id),
        index: Number(row.chunk_index),
        content: String(row.content),
        tokenCount: Number(row.token_count),
      },
      score: range > 0 ? (rawScores[i] - minScore) / range : 1.0,
      source: {
        id: String(row.doc_id),
        filename: String(row.filename),
        format: String(row.format) as SearchResult["source"]["format"],
        title: String(row.title),
        author: (row.author as string) || undefined,
        text: String(row.text),
        metadata: JSON.parse(String(row.metadata)) as Record<string, unknown>,
        ingestedAt: new Date(String(row.ingested_at)),
      },
    }))
  }

  /**
   * Ensure the FTS5 virtual table is synchronised with the chunks table.
   * Uses a full repopulation when counts differ (handles inserts + deletes).
   */
  private syncFTS(): void {
    const db = getDatabase()

    const chunkCount = (
      db.prepare("SELECT COUNT(*) AS cnt FROM chunks").get() as { cnt: number }
    ).cnt
    const ftsCount = (
      db
        .prepare("SELECT COUNT(*) AS cnt FROM chunks_fts")
        .get() as { cnt: number }
    ).cnt

    if (ftsCount >= chunkCount) return

    // Repopulate: DELETE all then INSERT fresh
    db.exec("DELETE FROM chunks_fts")

    const insert = db.prepare(
      "INSERT INTO chunks_fts (rowid, chunk_id, content) VALUES (?, ?, ?)",
    )
    const rows = db
      .prepare("SELECT rowid, id, content FROM chunks")
      .all() as { rowid: number; id: string; content: string }[]

    if (rows.length === 0) return

    const tx = db.transaction(() => {
      for (const row of rows) {
        insert.run(row.rowid, row.id, row.content)
      }
    })
    tx()
  }

  // FTS5 default stop words — words that are stripped by the tokenizer
  // and cause empty MATCH errors when used with the + prefix.
  private static readonly FTS_STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "but", "by",
    "for", "if", "in", "into", "is", "it", "no", "not", "of",
    "on", "or", "such", "that", "the", "their", "then", "there",
    "these", "they", "this", "to", "was", "will", "with",
  ])

  /**
   * Convert a natural-language query string into an FTS5 query.
   * Significant words are joined with AND for precision.
   * Common English stop words are excluded.
   */
  private buildFTSQuery(query: string): string {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1 && !QueryTool.FTS_STOP_WORDS.has(t))

    if (tokens.length === 0) return ""

    const escaped = tokens
      .map((t) => {
        const clean = t.replace(/[+\\\-*()~"'^]/g, "")
        return clean ? `"${clean}"` : ""
      })
      .filter(Boolean)

    if (escaped.length === 0) return ""
    // Join with AND so all terms must appear (precision over recall)
    return escaped.join(" AND ")
  }

  // ── Step 4: Hybrid Merge ─────────────────────────────────────────────────

  /**
   * Merge vector and FTS results with weighted ranking:
   *   finalScore = vectorSimilarity * 0.7 + ftsNormalisedScore * 0.3
   * Results are deduplicated by chunk ID then sorted by descending score.
   */
  private mergeHybridResults(
    vectorResults: SearchResult[],
    ftsResults: SearchResult[],
    limit: number,
    minScore: number,
  ): SearchResult[] {
    const resultMap = new Map<string, SearchResult>()

    // Add vector results with weighted score
    for (const result of vectorResults) {
      resultMap.set(result.chunk.id, {
        ...result,
        score: result.score * VECTOR_WEIGHT,
      })
    }

    // Merge FTS results (add weighted score to existing, or create new entry)
    for (const result of ftsResults) {
      const existing = resultMap.get(result.chunk.id)
      if (existing) {
        existing.score += result.score * FTS_WEIGHT
        if (result.entities && result.entities.length > 0) {
          existing.entities = [
            ...(existing.entities ?? []),
            ...result.entities,
          ]
        }
        if (result.relationships && result.relationships.length > 0) {
          existing.relationships = [
            ...(existing.relationships ?? []),
            ...result.relationships,
          ]
        }
      } else {
        resultMap.set(result.chunk.id, {
          ...result,
          score: result.score * FTS_WEIGHT,
        })
      }
    }

    return [...resultMap.values()]
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}
