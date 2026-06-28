import { fileURLToPath } from "url"
import { dirname, resolve } from "path"

const __dir = dirname(fileURLToPath(import.meta.url))

// The plugin return type extends Hooks with OpenCode extension fields
// (name, mcp) that are known at runtime but not in the published type defs.
type PluginReturn = Record<string, unknown> & {
  name: string
  mcp: Record<string, { type: "local"; command: string[]; enabled: boolean }>
}

const plugin = async (): Promise<PluginReturn> => {
  // Resolve path to the compiled MCP server script
  const serverScript = resolve(__dir, "mcp", "server.js")

  return {
    name: "mind-forge",

    mcp: {
      "mind-forge": {
        type: "local",
        command: ["node", serverScript],
        enabled: true,
      },
    },
  }
}

export default plugin
