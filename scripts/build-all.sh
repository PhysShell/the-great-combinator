#!/usr/bin/env bash
set -euo pipefail
# Build Rust CLI for current host
( cd core && cargo build --release )

# Copy/Place binaries into vscode-ext/bin/<plat>-<arch>/
PLAT="$(node -p "process.platform")"
ARCH="$(node -p "process.arch")"
BIN_DIR="vscode-ext/bin/${PLAT}-${ARCH}"
mkdir -p "$BIN_DIR"
if [[ "$PLAT" == "win32" ]]; then
  cp core/target/release/the-great-combinator.exe "$BIN_DIR"/the-great-combinator.exe
else
  cp core/target/release/the-great-combinator "$BIN_DIR"/the-great-combinator
  chmod +x "$BIN_DIR"/the-great-combinator
fi
echo "Binaries staged to $BIN_DIR"
