import { describe, it, expect, vi, beforeEach } from "vitest"
import { setConfig } from "../../src/lib/config.js"
import type { MindForgeConfig } from "../../src/lib/config.js"
import * as logger from "../../src/lib/logger.js"

// ── Helpers ────────────────────────────────────────────────────────────────

const defaultConfig: MindForgeConfig = {
  dbPath: "./mind-forge.db",
  embeddingModel: "nomic-embed-text",
  ollamaUrl: "http://localhost:11434",
  embedTimeoutMs: 30000,
  defaultChunkSize: 1000,
  maxDocumentBytes: 10 * 1024 * 1024,
  logLevel: "info",
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setConfig({ ...defaultConfig })
  })

  describe("debug", () => {
    it("should log when logLevel is debug", () => {
      setConfig({ ...defaultConfig, logLevel: "debug" })
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {})

      logger.debug("test message")

      expect(spy).toHaveBeenCalledWith("[mind-forge]", "test message")
    })

    it("should not log when logLevel is info", () => {
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {})

      logger.debug("test message")

      expect(spy).not.toHaveBeenCalled()
    })

    it("should not log when logLevel is warn", () => {
      setConfig({ ...defaultConfig, logLevel: "warn" })
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {})

      logger.debug("test message")

      expect(spy).not.toHaveBeenCalled()
    })

    it("should not log when logLevel is error", () => {
      setConfig({ ...defaultConfig, logLevel: "error" })
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {})

      logger.debug("test message")

      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe("info", () => {
    it("should log when logLevel is debug", () => {
      setConfig({ ...defaultConfig, logLevel: "debug" })
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})

      logger.info("test message")

      expect(spy).toHaveBeenCalledWith("[mind-forge]", "test message")
    })

    it("should log when logLevel is info", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})

      logger.info("test message")

      expect(spy).toHaveBeenCalled()
    })

    it("should not log when logLevel is warn", () => {
      setConfig({ ...defaultConfig, logLevel: "warn" })
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})

      logger.info("test message")

      expect(spy).not.toHaveBeenCalled()
    })

    it("should not log when logLevel is error", () => {
      setConfig({ ...defaultConfig, logLevel: "error" })
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})

      logger.info("test message")

      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe("warn", () => {
    it("should log when logLevel is debug", () => {
      setConfig({ ...defaultConfig, logLevel: "debug" })
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {})

      logger.warn("test message")

      expect(spy).toHaveBeenCalledWith("[mind-forge]", "test message")
    })

    it("should log when logLevel is info", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {})

      logger.warn("test message")

      expect(spy).toHaveBeenCalled()
    })

    it("should log when logLevel is warn", () => {
      setConfig({ ...defaultConfig, logLevel: "warn" })
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {})

      logger.warn("test message")

      expect(spy).toHaveBeenCalled()
    })

    it("should not log when logLevel is error", () => {
      setConfig({ ...defaultConfig, logLevel: "error" })
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {})

      logger.warn("test message")

      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe("error", () => {
    it("should always log regardless of logLevel", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})

      for (const level of ["debug", "info", "warn", "error"] as const) {
        setConfig({ ...defaultConfig, logLevel: level })
        logger.error("test error")
      }

      expect(spy).toHaveBeenCalledTimes(4)
    })

    it("should include prefix and message", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})

      logger.error("something went wrong", { detail: "foo" })

      expect(spy).toHaveBeenCalledWith("[mind-forge]", "something went wrong", { detail: "foo" })
    })
  })

  describe("additional args", () => {
    it("should pass extra arguments to console.debug", () => {
      setConfig({ ...defaultConfig, logLevel: "debug" })
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {})

      logger.debug("msg", 42, { key: "val" })

      expect(spy).toHaveBeenCalledWith("[mind-forge]", "msg", 42, { key: "val" })
    })
  })
})
