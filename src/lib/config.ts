import { homedir } from "node:os"
import { join } from "node:path"

// ── Typed Configuration ────────────────────────────────────────────────────

export interface MindForgeConfig {
  /** Path to the SQLite database file */
  dbPath: string
  /** Default embedding model for Ollama */
  embeddingModel: string
  /** Ollama API URL */
  ollamaUrl: string
  /** Embedding timeout in milliseconds */
  embedTimeoutMs: number
  /** Default chunk size in tokens */
  defaultChunkSize: number
  /** Maximum document size in bytes */
  maxDocumentBytes: number
  /** Log level */
  logLevel: "debug" | "info" | "warn" | "error"
}

const DEFAULTS: MindForgeConfig = {
  dbPath: join(homedir(), ".mind-forge", "store.db"),
  embeddingModel: "nomic-embed-text",
  ollamaUrl: "http://localhost:11434",
  embedTimeoutMs: 30000,
  defaultChunkSize: 1000,
  maxDocumentBytes: 10 * 1024 * 1024, // 10MB
  logLevel: "info",
}

export function loadConfig(overrides?: Partial<MindForgeConfig>): MindForgeConfig {
  return {
    dbPath: process.env.MIND_FORGE_DB_PATH ?? (overrides?.dbPath ?? DEFAULTS.dbPath),
    embeddingModel: process.env.MIND_FORGE_EMBEDDING_MODEL ?? (overrides?.embeddingModel ?? DEFAULTS.embeddingModel),
    ollamaUrl: process.env.MIND_FORGE_OLLAMA_URL ?? (overrides?.ollamaUrl ?? DEFAULTS.ollamaUrl),
    embedTimeoutMs: Number(process.env.MIND_FORGE_EMBED_TIMEOUT_MS) || (overrides?.embedTimeoutMs ?? DEFAULTS.embedTimeoutMs),
    defaultChunkSize: Number(process.env.MIND_FORGE_DEFAULT_CHUNK_SIZE) || (overrides?.defaultChunkSize ?? DEFAULTS.defaultChunkSize),
    maxDocumentBytes: Number(process.env.MIND_FORGE_MAX_DOCUMENT_BYTES) || (overrides?.maxDocumentBytes ?? DEFAULTS.maxDocumentBytes),
    logLevel: (process.env.MIND_FORGE_LOG_LEVEL as MindForgeConfig["logLevel"]) ?? (overrides?.logLevel ?? DEFAULTS.logLevel),
  }
}

let currentConfig: MindForgeConfig | null = null

export function getConfig(): MindForgeConfig {
  if (!currentConfig) {
    currentConfig = loadConfig()
  }
  return currentConfig
}

export function setConfig(config: MindForgeConfig): void {
  currentConfig = config
}
