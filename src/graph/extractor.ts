// ── Pattern-based Entity & Relationship Extraction ───────────────────────

import crypto from "node:crypto"
import type { DocumentChunk, Entity, Relationship, EntityType, RelationshipType } from "../types.js"

// ── Constants ────────────────────────────────────────────────────────────

const ENTITY_STOP_WORDS = new Set([
  "This", "That", "These", "Those", "The", "A", "An", "And", "Or", "But",
  "If", "Then", "Because", "So", "However", "Therefore", "Moreover",
  "Furthermore", "Nevertheless", "Nonetheless", "Meanwhile", "Hence",
  "Thus", "Also", "Too", "Very", "Just", "Only", "Even", "Yet", "Still",
  "I", "You", "He", "She", "It", "We", "They", "Me", "Him", "Her", "Us",
  "Them", "My", "Your", "His", "Its", "Our", "Their", "Mine", "Yours",
  "Hers", "Ours", "Theirs", "Who", "Whom", "Which", "What", "When",
  "Where", "Why", "How", "All", "Each", "Every", "Both", "Few", "Many",
  "Much", "Some", "Any", "No", "Not", "None", "Nothing", "Everything",
  "Something", "Anything", "First", "Last", "Next", "Previous", "Final",
  "Initial", "Primary", "Secondary", "Main", "Major", "Minor", "Key",
  "Important", "Critical", "Essential", "Basic", "Common", "Simple",
  "Complex", "Specific", "General", "Various", "Different", "Multiple",
  "Several", "Numerous", "Countless", "Please", "Could", "Would",
  "Should", "May", "Might", "Must", "Shall", "Will", "Can", "Need",
  "Do", "Does", "Did", "Has", "Have", "Had", "Being", "Been", "Am",
  "Are", "Is", "Was", "Were", "Be", "Been", "Having", "Doing",
])

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December"

const DATE_PATTERNS = [
  new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:,?\\s+\\d{4})?\\b`, "gi"),
  // Standalone 4-digit years (1000-2099, not part of larger numbers)
  /\b(?<![\d.])(?:1[0-9]{3}|20[0-9]{2})\b(?!\d)/g,
]

// ── Note on entity word separators ───────────────────────────────────────
// Entity labels can contain hyphens (e.g. "High-Level Language"), so the
// inter-word separator inside entity groups is `(?:[\s-]+)` rather than
// plain `\s+`.  The verb/preposition parts still use `\s+`.

const DEFINITION_PATTERNS = [
  // "X is a Y", "X is an Y"
  /\b([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)\s+is\s+(?:a|an|the)\s+(.+?)(?:\.|$)/g,
  // "X refers to Y"
  /\b([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)\s+refers\s+to\s+(.+?)(?:\.|$)/g,
  // "X is defined as Y"
  /\b([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)\s+is\s+defined\s+as\s+(.+?)(?:\.|$)/g,
]

const DEPENDS_ON_PATTERNS = [
  /\b([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)\s+(?:depends?\s+(?:on|upon)|rel(?:ies|y)\s+on|requires?|uses?)\s+(?:(?:the|a|an)\s+)?([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)/g,
]

const PART_OF_PATTERNS = [
  /\b([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)\s+is\s+(?:(?:a|an)\s+)?part\s+of\s+(?:(?:the|a|an)\s+)?([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)/g,
  /\b([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)\s+(?:belongs?\s+to|is\s+(?:(?:a|an)\s+)?component\s+of)\s+(?:(?:the|a|an)\s+)?([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)/g,
]

const EXAMPLE_PATTERNS = [
  /\b([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)\s+is\s+(?:(?:a|an)\s+)?example\s+of\s+(?:(?:the|a|an)\s+)?([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)/g,
  /\b(?:For\s+example,?\s*)([A-Z][a-zA-Z]+(?:[\s-]+[A-Z][a-zA-Z]+)*)/g,
]

const FORMULA_MARKERS = /[=+\-*/^]/

// ── Options ──────────────────────────────────────────────────────────────

export interface ExtractorOptions {
  /**
   * Optional LLM-based callback for more sophisticated extraction.
   * When provided, results are merged with pattern-based extraction.
   */
  llmCallback?: (
    chunks: DocumentChunk[],
  ) => Promise<{ entities: Entity[]; relationships: Relationship[] }>
}

// ── Main Extraction ─────────────────────────────────────────────────────

/**
 * Extract entities and relationships from document chunks using pattern matching.
 *
 * For MVP, uses regex patterns and co-occurrence heuristics.
 * An optional `llmCallback` can be provided for more sophisticated extraction
 * (will be merged with pattern-based results).
 */
export async function extractEntitiesAndRelationships(
  chunks: DocumentChunk[],
  options?: ExtractorOptions,
): Promise<{ entities: Entity[]; relationships: Relationship[] }> {
  if (chunks.length === 0) {
    return { entities: [], relationships: [] }
  }

  // ── Pass 1: Extract entities via patterns ───────────────────────────

  const entityMap = new Map<string, Entity>()
  const labelToId = new Map<string, string>()

  for (const chunk of chunks) {
    extractEntitiesFromChunk(chunk, entityMap, labelToId)
  }

  // ── Pass 2: Extract relationships ───────────────────────────────────

  const relationships = extractRelationships(chunks, labelToId)

  // ── Merge with LLM callback if provided ─────────────────────────────

  const resultEntities = [...entityMap.values()]
  const resultRelationships = [...relationships]

  if (options?.llmCallback) {
    const llmResult = await options.llmCallback(chunks)
    const existingIds = new Set(resultEntities.map((e) => e.id))
    for (const entity of llmResult.entities) {
      if (!existingIds.has(entity.id)) {
        resultEntities.push(entity)
      }
    }
    resultRelationships.push(...llmResult.relationships)
  }

  return { entities: resultEntities, relationships: resultRelationships }
}

// ── Entity Extraction ────────────────────────────────────────────────────

function extractEntitiesFromChunk(
  chunk: DocumentChunk,
  entityMap: Map<string, Entity>,
  labelToId: Map<string, string>,
): void {
  const { content, id: chunkId } = chunk

  // 1. Extract definition entities (captures entities + their descriptions)
  extractDefinitionEntities(content, chunkId, entityMap, labelToId)

  // 2. Extract formula-like entities
  extractFormulaEntities(content, chunkId, entityMap, labelToId)

  // 3. Extract date entities
  extractDateEntities(content, chunkId, entityMap, labelToId)

  // 4. Extract general capitalized terms (single + multi-word, including acronyms)
  extractCapitalizedTerms(content, chunkId, entityMap, labelToId)
}

function extractDefinitionEntities(
  content: string,
  chunkId: string,
  entityMap: Map<string, Entity>,
  labelToId: Map<string, string>,
): void {
  for (const pattern of DEFINITION_PATTERNS) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const label = normalizeLabel(match[1])
      const description = match[2].trim()
      if (label && !ENTITY_STOP_WORDS.has(label)) {
        addOrUpdateEntity(entityMap, labelToId, label, "definition", description, chunkId)
      }
    }
  }
}

function extractFormulaEntities(
  content: string,
  chunkId: string,
  entityMap: Map<string, Entity>,
  labelToId: Map<string, string>,
): void {
  const lines = content.split(/[.;\n]/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (FORMULA_MARKERS.test(trimmed) && trimmed.length > 1 && trimmed.length <= 80) {
      const formulaLabel = trimmed.substring(0, 40).trim()
      if (formulaLabel.length > 2 && !ENTITY_STOP_WORDS.has(formulaLabel.split(/\s+/)[0])) {
        addOrUpdateEntity(entityMap, labelToId, formulaLabel, "formula", trimmed, chunkId)
      }
    }
  }
}

function extractDateEntities(
  content: string,
  chunkId: string,
  entityMap: Map<string, Entity>,
  labelToId: Map<string, string>,
): void {
  for (const pattern of DATE_PATTERNS) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const dateLabel = match[0].trim()
      if (dateLabel.length > 0) {
        addOrUpdateEntity(entityMap, labelToId, dateLabel, "date", `Year/date: ${dateLabel}`, chunkId)
      }
    }
  }
}

function extractCapitalizedTerms(
  content: string,
  chunkId: string,
  entityMap: Map<string, Entity>,
  labelToId: Map<string, string>,
): void {
  const seen = new Set<string>()

  /**
   * Returns true if the label's first word is a known stop word (e.g. "The",
   * "This", "These") or any component word is a stop word.  This prevents
   * extracting spurious entries like "The CPU" or "This Example".
   */
  const containsStopWord = (label: string): boolean => {
    const words = label.split(/[\s-]+/)
    return words.some((w) => ENTITY_STOP_WORDS.has(w))
  }

  // Match multi-word capitalized terms (e.g. "Machine Learning", "Virtual DOM",
  // "High-Level Language")
  const multiWordRegex = /\b[A-Z][a-zA-Z]*(?:[\s-]+[A-Z][a-zA-Z]*)+\b/g
  let match: RegExpExecArray | null
  while ((match = multiWordRegex.exec(content)) !== null) {
    const label = match[0].trim()
    if (seen.has(label) || containsStopWord(label)) continue
    seen.add(label)
    if (labelToId.has(label)) continue

    const desc = extractContext(content, label)
    addOrUpdateEntity(entityMap, labelToId, label, "concept", desc, chunkId)
  }

  // Match single capitalized words (e.g. "Semantics", "React")
  const singleWordRegex = /\b[A-Z][a-z]+\b/g
  while ((match = singleWordRegex.exec(content)) !== null) {
    const label = match[0].trim()
    if (seen.has(label) || ENTITY_STOP_WORDS.has(label) || label.length < 2) continue
    seen.add(label)
    if (labelToId.has(label)) continue

    const desc = extractContext(content, label)
    addOrUpdateEntity(entityMap, labelToId, label, "concept", desc, chunkId)
  }

  // Match all-uppercase acronyms (e.g. "NLP", "CPU", "AI")
  const acronymRegex = /\b[A-Z]{2,}\b/g
  while ((match = acronymRegex.exec(content)) !== null) {
    const label = match[0].trim()
    if (seen.has(label) || ENTITY_STOP_WORDS.has(label) || label.length < 2) continue
    seen.add(label)
    if (labelToId.has(label)) continue

    const desc = extractContext(content, label)
    addOrUpdateEntity(entityMap, labelToId, label, "concept", desc, chunkId)
  }
}

function extractContext(content: string, label: string): string {
  const sentenceRegex = new RegExp(
    `[^.!?]*\\b${escapeRegex(label)}\\b[^.!?]*[.!?]`,
    "i",
  )
  const match = sentenceRegex.exec(content)
  return match ? match[0].trim() : ""
}

// ── Relationship Extraction ─────────────────────────────────────────────

function extractRelationships(
  chunks: DocumentChunk[],
  labelToId: Map<string, string>,
): Relationship[] {
  const relationships: Relationship[] = []
  const seen = new Set<string>()

  for (const chunk of chunks) {
    // 1. Extract typed relationships from patterns
    extractTypedRelationships(chunk, labelToId, relationships, seen)

    // 2. Co-occurrence relationships (default depends_on, lower confidence)
    extractCooccurrenceRelationships(chunk, labelToId, relationships, seen)
  }

  return relationships
}

function extractTypedRelationships(
  chunk: DocumentChunk,
  labelToId: Map<string, string>,
  relationships: Relationship[],
  seen: Set<string>,
): void {
  const { content, id: chunkId } = chunk

  // "depends_on" patterns
  extractPatternRelationships(
    content, DEPENDS_ON_PATTERNS, labelToId, "depends_on", chunkId, relationships, seen, 0.7,
  )

  // "part_of" patterns
  extractPatternRelationships(
    content, PART_OF_PATTERNS, labelToId, "part_of", chunkId, relationships, seen, 0.8,
  )

  // "example_of" patterns
  extractPatternRelationships(
    content, EXAMPLE_PATTERNS, labelToId, "example_of", chunkId, relationships, seen, 0.75,
  )

  // "defined_by" — from definition patterns (X is defined as ...)
  for (const pattern of DEFINITION_PATTERNS) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const fromLabel = normalizeLabel(match[1])
      const description = match[2].trim()
      const toLabel = findKnownEntityInText(description, labelToId, fromLabel)
      if (fromLabel && toLabel && fromLabel !== toLabel) {
        const fromId = labelToId.get(fromLabel)
        const toId = labelToId.get(toLabel)
        if (fromId && toId) {
          addRelationshipIfNew(relationships, seen, fromId, toId, "defined_by", chunkId, 0.85)
        }
      }
    }
  }
}

/**
 * Remove leading stop words from a label so slug terms like "The CPU" become
 * "CPU" — matching what the entity extractor actually stored.
 */
function trimLeadingStopWords(label: string): string {
  const words = label.split(/\s+/)
  while (words.length > 0 && ENTITY_STOP_WORDS.has(words[0])) {
    words.shift()
  }
  return words.join(" ")
}

function extractPatternRelationships(
  content: string,
  patterns: RegExp[],
  labelToId: Map<string, string>,
  relType: RelationshipType,
  chunkId: string,
  relationships: Relationship[],
  seen: Set<string>,
  confidence: number,
): void {
  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const fromLabel = trimLeadingStopWords(normalizeLabel(match[1]))
      const toLabel = trimLeadingStopWords(normalizeLabel(match[2]))
      if (fromLabel && toLabel && fromLabel !== toLabel) {
        const fromId = labelToId.get(fromLabel)
        const toId = labelToId.get(toLabel)
        if (fromId && toId) {
          addRelationshipIfNew(relationships, seen, fromId, toId, relType, chunkId, confidence)
        }
      }
    }
  }
}

function extractCooccurrenceRelationships(
  chunk: DocumentChunk,
  labelToId: Map<string, string>,
  relationships: Relationship[],
  seen: Set<string>,
): void {
  const presentLabels: string[] = []
  for (const [label] of labelToId) {
    // Check both exact word match and broader match
    if (chunkContentContains(chunk.content, label)) {
      presentLabels.push(label)
    }
  }

  for (let i = 0; i < presentLabels.length; i++) {
    for (let j = i + 1; j < presentLabels.length; j++) {
      const idA = labelToId.get(presentLabels[i])!
      const idB = labelToId.get(presentLabels[j])!

      // Only create co-occurrence relationship if no typed one already exists
      const existingKeyA = [idA, idB].sort().join("::")
      let hasExisting = false
      for (const rt of ["depends_on", "part_of", "defined_by", "example_of"] as RelationshipType[]) {
        if (seen.has(`${existingKeyA}::${rt}`)) {
          hasExisting = true
          break
        }
      }
      if (!hasExisting) {
        addRelationshipIfNew(relationships, seen, idA, idB, "depends_on", chunk.id, 0.4)
      }
    }
  }
}

/**
 * Check whether text contains a known entity label as a word-boundary match.
 * Used for co-occurrence detection and definition-relationship mapping.
 */
function chunkContentContains(content: string, label: string): boolean {
  const escaped = escapeRegex(label)
  const pattern = new RegExp(`\\b${escaped}\\b`)
  return pattern.test(content)
}

/**
 * Scan text for any known entity label, optionally excluding a specific label.
 */
function findKnownEntityInText(
  text: string,
  labelToId: Map<string, string>,
  excludeLabel?: string,
): string | null {
  // Try longer labels first (more specific match)
  const sorted = [...labelToId.keys()].sort((a, b) => b.length - a.length)
  for (const label of sorted) {
    if (excludeLabel && label === excludeLabel) continue
    const escaped = escapeRegex(label)
    const pattern = new RegExp(`\\b${escaped}\\b`)
    if (pattern.test(text)) {
      return label
    }
  }
  return null
}

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeLabel(label: string): string {
  return label.trim()
}

function addOrUpdateEntity(
  entityMap: Map<string, Entity>,
  labelToId: Map<string, string>,
  label: string,
  type: EntityType,
  description: string,
  chunkId: string,
): void {
  const existing = entityMap.get(label)
  if (existing) {
    // Update description if new one is longer
    if (description.length > existing.description.length) {
      existing.description = description
    }
    // Prefer more specific type over generic "concept"
    if ((type === "definition" || type === "formula") && existing.type === "concept") {
      existing.type = type
    }
  } else {
    const id = crypto.randomUUID()
    entityMap.set(label, {
      id,
      label,
      type,
      description,
      chunkId,
      metadata: {},
    })
    labelToId.set(label, id)
  }
}

function addRelationshipIfNew(
  relationships: Relationship[],
  seen: Set<string>,
  fromId: string,
  toId: string,
  type: RelationshipType,
  chunkId: string,
  confidence: number,
): void {
  const [a, b] = [fromId, toId].sort()
  const key = `${a}::${b}::${type}`
  if (seen.has(key)) return
  seen.add(key)

  relationships.push({
    id: crypto.randomUUID(),
    fromEntityId: fromId,
    toEntityId: toId,
    type,
    chunkId,
    confidence,
  })
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
