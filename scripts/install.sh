#!/usr/bin/env bash
set -euo pipefail

echo "=== Mind Forge Installer ==="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required. Install from https://nodejs.org"; exit 1; }
echo "✓ Node.js $(node --version) detected"

# Install dependencies
npm install

# Build
npm run build

echo ""
echo "✓ Mind Forge installed successfully!"
echo ""
echo "To register in your OpenCode config, add to opencode.json:"
echo ""
echo '  "mcpServers": {'
echo '    "mind-forge": {'
echo '      "command": "node",'
echo '      "args": ["'"$(pwd)"'/dist/index.js"]'
echo '    }'
echo '  }'
echo ""
