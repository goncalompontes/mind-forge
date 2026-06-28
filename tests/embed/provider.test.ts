import { describe, it, expect, vi, beforeEach } from "vitest"
import { createEmbeddingProvider } from "../../src/embed/provider.js"

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("../../src/embed/ollama.js", () => {
  const mockEmbed = vi.fn()
  const mockHealth = vi.fn()
  return {
    createOllamaProvider: vi.fn(() => ({
      embed: mockEmbed,
      health: mockHealth,
      _name: "ollama",
    })),
  }
})

vi.mock("../../src/embed/llm-provider.js", () => {
  const mockEmbed = vi.fn()
  const mockHealth = vi.fn()
  return {
    createLLMEmbeddingProvider: vi.fn(() => ({
      embed: mockEmbed,
      health: mockHealth,
      _name: "llm",
    })),
  }
})

import { createOllamaProvider } from "../../src/embed/ollama.js"
import { createLLMEmbeddingProvider } from "../../src/embed/llm-provider.js"

// ── Tests ────────────────────────────────────────────────────────────────

describe("createEmbeddingProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should create an Ollama provider by default (auto mode)", () => {
    createOllamaProvider.mockReturnValue({
      embed: vi.fn(),
      health: vi.fn().mockResolvedValue(true),
      _name: "ollama",
    })

    const provider = createEmbeddingProvider()

    expect(provider).toBeDefined()
    expect(typeof provider.embed).toBe("function")
    expect(typeof provider.health).toBe("function")
  })

  it("should create Ollama provider when force=ollama", () => {
    createOllamaProvider.mockReturnValue({
      embed: vi.fn(),
      health: vi.fn(),
      _name: "ollama",
    })

    const provider = createEmbeddingProvider({ provider: "ollama" })
    expect(createOllamaProvider).toHaveBeenCalled()
    expect(createLLMEmbeddingProvider).not.toHaveBeenCalled()
    expect(provider).toBeDefined()
  })

  it("should create LLM provider when force=llm", () => {
    createLLMEmbeddingProvider.mockReturnValue({
      embed: vi.fn(),
      health: vi.fn(),
      _name: "llm",
    })

    const provider = createEmbeddingProvider({
      provider: "llm",
      llm: { apiKey: "sk-test" },
    })

    expect(createLLMEmbeddingProvider).toHaveBeenCalled()
    expect(createOllamaProvider).not.toHaveBeenCalled()
    expect(provider).toBeDefined()
  })

  it("should pass ollama config when forcing ollama", () => {
    createOllamaProvider.mockReturnValue({
      embed: vi.fn(),
      health: vi.fn(),
      _name: "ollama",
    })

    createEmbeddingProvider({
      provider: "ollama",
      ollama: { baseUrl: "http://custom:11434", model: "custom-model" },
    })

    expect(createOllamaProvider).toHaveBeenCalledWith({
      baseUrl: "http://custom:11434",
      model: "custom-model",
    })
  })

  it("should pass llm config when forcing llm", () => {
    createLLMEmbeddingProvider.mockReturnValue({
      embed: vi.fn(),
      health: vi.fn(),
      _name: "llm",
    })

    createEmbeddingProvider({
      provider: "llm",
      llm: {
        apiUrl: "https://custom.ai/v1",
        apiKey: "sk-custom",
        model: "custom-embed",
      },
    })

    expect(createLLMEmbeddingProvider).toHaveBeenCalledWith({
      apiUrl: "https://custom.ai/v1",
      apiKey: "sk-custom",
      model: "custom-embed",
    })
  })

  it("should throw when force=llm but no apiKey provided", () => {
    expect(() =>
      createEmbeddingProvider({
        provider: "llm",
        llm: {},
      }),
    ).toThrow()
  })

  it("should fallback to LLM when Ollama health check fails in auto mode", async () => {
    const ollamaHealth = vi.fn().mockResolvedValue(false)
    const llmHealth = vi.fn().mockResolvedValue(true)

    createOllamaProvider.mockReturnValue({
      embed: vi.fn(),
      health: ollamaHealth,
      _name: "ollama",
    })
    createLLMEmbeddingProvider.mockReturnValue({
      embed: vi.fn(),
      health: llmHealth,
      _name: "llm",
    })

    const provider = createEmbeddingProvider({
      llm: { apiKey: "sk-fallback" },
    })

    // Pre-fallback: should be Ollama wrapper that auto-fallbacks
    const healthy = await provider.health()
    expect(ollamaHealth).toHaveBeenCalled()
    expect(llmHealth).toHaveBeenCalled()
    expect(healthy).toBe(true)
  })

  it("should handle unknown provider value as auto", () => {
    createOllamaProvider.mockReturnValue({
      embed: vi.fn(),
      health: vi.fn(),
    })

    const provider = createEmbeddingProvider({
      provider: "unknown" as "auto",
    })

    expect(provider).toBeDefined()
  })
})
