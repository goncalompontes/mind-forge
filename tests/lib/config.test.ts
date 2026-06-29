import { describe, it, expect, afterEach } from "vitest"
import { loadConfig, getConfig, setConfig } from "../../src/lib/config.js"
import type { MindForgeConfig } from "../../src/lib/config.js"
import { homedir } from "node:os"
import { join } from "node:path"

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_DB_PATH = join(homedir(), ".mind-forge", "store.db")

function clearEnvVars(): void {
  delete process.env.MIND_FORGE_DB_PATH
  delete process.env.MIND_FORGE_EMBEDDING_MODEL
  delete process.env.MIND_FORGE_OLLAMA_URL
  delete process.env.MIND_FORGE_EMBED_TIMEOUT_MS
  delete process.env.MIND_FORGE_DEFAULT_CHUNK_SIZE
  delete process.env.MIND_FORGE_MAX_DOCUMENT_BYTES
  delete process.env.MIND_FORGE_LOG_LEVEL
}

// ── loadConfig ─────────────────────────────────────────────────────────────

describe("loadConfig", () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("should return defaults when no env vars or overrides", () => {
    clearEnvVars()

    const config = loadConfig()

    expect(config.dbPath).toBe(DEFAULT_DB_PATH)
    expect(config.embeddingModel).toBe("nomic-embed-text")
    expect(config.ollamaUrl).toBe("http://localhost:11434")
    expect(config.embedTimeoutMs).toBe(30000)
    expect(config.defaultChunkSize).toBe(1000)
    expect(config.maxDocumentBytes).toBe(10 * 1024 * 1024)
    expect(config.logLevel).toBe("info")
  })

  it("should override with environment variables", () => {
    clearEnvVars()
    process.env.MIND_FORGE_DB_PATH = "/custom/db.sqlite"
    process.env.MIND_FORGE_EMBEDDING_MODEL = "custom-model"
    process.env.MIND_FORGE_OLLAMA_URL = "http://custom:11434"
    process.env.MIND_FORGE_EMBED_TIMEOUT_MS = "50000"
    process.env.MIND_FORGE_DEFAULT_CHUNK_SIZE = "500"
    process.env.MIND_FORGE_MAX_DOCUMENT_BYTES = "5242880"
    process.env.MIND_FORGE_LOG_LEVEL = "debug"

    const config = loadConfig()

    expect(config.dbPath).toBe("/custom/db.sqlite")
    expect(config.embeddingModel).toBe("custom-model")
    expect(config.ollamaUrl).toBe("http://custom:11434")
    expect(config.embedTimeoutMs).toBe(50000)
    expect(config.defaultChunkSize).toBe(500)
    expect(config.maxDocumentBytes).toBe(5242880)
    expect(config.logLevel).toBe("debug")
  })

  it("should have env vars take precedence over explicit overrides", () => {
    clearEnvVars()
    process.env.MIND_FORGE_EMBEDDING_MODEL = "env-model"

    const config = loadConfig({ embeddingModel: "override-model" })

    expect(config.embeddingModel).toBe("env-model")
  })

  it("should use explicit overrides when env var is not set", () => {
    clearEnvVars()

    const config = loadConfig({ dbPath: "/override/db.sqlite" })

    expect(config.dbPath).toBe("/override/db.sqlite")
  })

  it("should have env vars take precedence over defaults", () => {
    clearEnvVars()
    process.env.MIND_FORGE_EMBEDDING_MODEL = "env-model"

    const config = loadConfig()

    expect(config.embeddingModel).toBe("env-model")
  })

  it("should fall back to override when env var is not set", () => {
    clearEnvVars()

    const config = loadConfig({ dbPath: "/custom/path.db" })

    expect(config.dbPath).toBe("/custom/path.db")
  })

  it("should fall back to default when env var and override are not set", () => {
    clearEnvVars()

    const config = loadConfig()

    expect(config.dbPath).toBe(DEFAULT_DB_PATH)
  })

  it("should accept logLevel warn via overrides", () => {
    clearEnvVars()

    const config = loadConfig({ logLevel: "warn" })

    expect(config.logLevel).toBe("warn")
  })

  it("should accept logLevel error via overrides", () => {
    clearEnvVars()

    const config = loadConfig({ logLevel: "error" })

    expect(config.logLevel).toBe("error")
  })
})

// ── getConfig / setConfig ──────────────────────────────────────────────────

describe("getConfig / setConfig", () => {
  it("should return a valid config on first call without setConfig", () => {
    const config = getConfig()
    expect(config).toBeDefined()
    expect(typeof config.dbPath).toBe("string")
    expect(typeof config.embedTimeoutMs).toBe("number")
  })

  it("should return a previously set config", () => {
    const custom: MindForgeConfig = {
      dbPath: ":memory:",
      embeddingModel: "test-model",
      ollamaUrl: "http://test:11434",
      embedTimeoutMs: 1000,
      defaultChunkSize: 500,
      maxDocumentBytes: 1024,
      logLevel: "debug",
    }

    setConfig(custom)
    expect(getConfig()).toBe(custom)
  })

  it("should update the config when setConfig is called again", () => {
    const first: MindForgeConfig = {
      dbPath: ":memory:",
      embeddingModel: "first",
      ollamaUrl: "http://first:11434",
      embedTimeoutMs: 1000,
      defaultChunkSize: 500,
      maxDocumentBytes: 1024,
      logLevel: "debug",
    }

    const second: MindForgeConfig = {
      dbPath: ":memory:",
      embeddingModel: "second",
      ollamaUrl: "http://second:11434",
      embedTimeoutMs: 2000,
      defaultChunkSize: 100,
      maxDocumentBytes: 2048,
      logLevel: "info",
    }

    setConfig(first)
    expect(getConfig().embeddingModel).toBe("first")

    setConfig(second)
    expect(getConfig().embeddingModel).toBe("second")
  })
})
