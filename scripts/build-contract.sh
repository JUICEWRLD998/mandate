#!/usr/bin/env bash
# Build the z-mandate WASM component that register.ts uploads.
# Requires: Rust stable + the wasm32-wasip2 target (added automatically).
# The wasm32-wasip2 build needs NO MSVC linker (bundled wasm-ld) — the native
# GNU toolchain is only needed for `cargo test`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/contract"

if ! rustup target list --installed 2>/dev/null | grep -q '^wasm32-wasip2$'; then
  echo "adding wasm32-wasip2 target..."
  rustup target add wasm32-wasip2
fi

cargo build --release

ARTIFACT="target/wasm32-wasip2/release/z_mandate.wasm"
echo "built: $ROOT/contract/$ARTIFACT ($(wc -c < "$ARTIFACT") bytes)"
echo "next: (cd host && npm run register)"
