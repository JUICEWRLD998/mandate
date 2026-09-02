#!/usr/bin/env bash
# Start the mock money rail (Express) on :8787 (override with RAIL_PORT).
# The rail appends every received payload to mock-rail/rail.log (gitignored) —
# that file is the demo's "counterparty view" (real values) vs the agent's
# agent-output.log (markers only).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/mock-rail"

if [ ! -d node_modules ]; then
  echo "installing mock-rail deps (first run)..."
  npm install
fi

echo "mock money rail on http://localhost:${RAIL_PORT:-8787} (endpoints: GET /health, POST /kyc, POST /pay)"
exec npm start
