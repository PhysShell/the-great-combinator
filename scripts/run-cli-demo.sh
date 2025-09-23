#!/usr/bin/env bash
set -euo pipefail

if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
  CLI=core/target/release/the-great-combinator.exe
else
  CLI=core/target/release/the-great-combinator
fi

echo "=== CLI Demo: Valid JSON ==="
JSON='{"paths":["./core/src","./README.md"],"workspace_root":"."}'
echo "Input: $JSON"
echo "$JSON" | "$CLI" --mode clipboard --header-format 'File ${index}: ${relpath}' --separator '\n---\n' --debug | sed -n '1,60p'

echo -e "\n=== CLI Demo: Invalid JSON (should show nice error) ==="
echo "Input: not-json-at-all"
echo "not-json-at-all" | "$CLI" --mode clipboard --debug 2>&1 | head -10 || echo "^ Expected error with helpful message"

echo -e "\n=== CLI Demo: Empty input (should show nice error) ==="
echo "Input: (empty)"
echo "" | "$CLI" --mode clipboard --debug 2>&1 | head -5 || echo "^ Expected error with helpful message"
