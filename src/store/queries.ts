// ── Query Layer Barrel ───────────────────────────────────────────────────
// Re-exports all query functions from domain-specific sub-modules.

export {
  insertDocument,
  insertChunks,
  deleteDocument,
  findDocumentByFilename,
  listDocuments,
  getDocument,
  getChunksByDocumentId,
  getAllChunks,
  getChunkCount,
  getFTSCount,
  clearFTS,
  insertFTSRow,
  ftsSearch,
  getDocumentsByTags,
  addTagsToDocument,
  removeTagsFromDocument,
} from "./document-queries.js"

export {
  insertEmbedding,
  searchSimilar,
} from "./embedding-queries.js"

export {
  insertStudyCard,
  getStudyCard,
  getStudyCardsByDocumentIds,
  getDueCards,
  updateStudyCardReview,
  insertQuiz,
  getQuiz,
  insertExamSession,
  upsertExamSession,
  getExamSessionByExamId,
  updateExamSubmission,
} from "./study-queries.js"

export {
  storeGraphData,
  getEntity,
  queryByType,
  searchEntities,
  getRelationshipsForEntity,
  getNeighborEntities,
  getNeighborIds,
} from "./graph-queries.js"
