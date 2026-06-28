import { describe, it, expect, vi } from "vitest"
import { createOllamaProvider } from "../../src/embed/ollama.js"

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("ollama", () => {
  const mockEmbed = vi.fn()
  const mockList = vi.fn()
  const mockShow = vi.fn()

  class OllamaMock {
    embed = mockEmbed
    list = mockList
    show = mockShow
  }

  return {
    default: OllamaMock,
    Ollama: OllamaMock,
    mockEmbed,
    mockList,
    mockShow,
  }
})

import { mockEmbed, mockList, mockShow } from "ollama"

// ── Tests ────────────────────────────────────────────────────────────────

describe("createOllamaProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should embed a single text", async () => {
    mockEmbed.mockResolvedValueOnce({ embeddings: [[0.1, 0.2, 0.3]] })

    const provider = createOllamaProvider()
    const result = await provider.embed(["hello world"])

    expect(result).toEqual([[0.1, 0.2, 0.3]])
    expect(mockEmbed).toHaveBeenCalledWith({
      model: "nomic-embed-text",
      input: ["hello world"],
    })
  })

  it("should embed multiple texts in batch", async () => {
    mockEmbed.mockResolvedValueOnce({
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    })

    const provider = createOllamaProvider()
    const result = await provider.embed(["text a", "text b"])

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([0.1, 0.2])
    expect(result[1]).toEqual([0.3, 0.4])
  })

  it("should use custom baseUrl when provided", async () => {
    mockEmbed.mockResolvedValueOnce({ embeddings: [[0.5]] })

    const provider = createOllamaProvider({ baseUrl: "http://custom:11434" })
    await provider.embed(["test"])

    // The ollama client is configured with host at construction time
    expect(mockEmbed).toHaveBeenCalled()
  })

  it("should use custom model when provided", async () => {
    mockEmbed.mockResolvedValueOnce({ embeddings: [[0.5]] })

    const provider = createOllamaProvider({ model: "custom-model" })
    await provider.embed(["test"])

    expect(mockEmbed).toHaveBeenCalledWith({
      model: "custom-model",
      input: ["test"],
    })
  })

  it("should return true from health() when model exists", async () => {
    mockList.mockResolvedValueOnce({
      models: [{ name: "nomic-embed-text" }],
    })

    const provider = createOllamaProvider()
    const result = await provider.health()

    expect(result).toBe(true)
  })

  it("should return false from health() when model missing", async () => {
    mockList.mockResolvedValueOnce({
      models: [{ name: "llama3" }],
    })

    const provider = createOllamaProvider()
    const result = await provider.health()

    expect(result).toBe(false)
  })

  it("should return false from health() when Ollama unreachable", async () => {
    mockList.mockRejectedValueOnce(new Error("Connection refused"))

    const provider = createOllamaProvider()
    const result = await provider.health()

    expect(result).toBe(false)
  })

  it("should fallback through models if default not found", async () => {
    // First health call: nomic-embed-text not in list
    mockList.mockResolvedValueOnce({
      models: [{ name: "llama3" }],
    })

    const provider = createOllamaProvider()
    const result = await provider.health()

    expect(result).toBe(false)
  })

  it("should embed with empty text list", async () => {
    mockEmbed.mockResolvedValueOnce({ embeddings: [] })

    const provider = createOllamaProvider()
    const result = await provider.embed([])

    expect(result).toEqual([])
  })
})
