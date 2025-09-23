#!/usr/bin/env bash
set -euo pipefail
( cd vscode-ext && yarn && yarn build && vsce package )
