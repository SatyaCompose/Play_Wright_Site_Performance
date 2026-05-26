#!/bin/bash
# PostToolUse hook — runs ESLint on any backend TypeScript file after Write or Edit.
# Outputs lint warnings back to Claude so issues are fixed in the same turn.

set -euo pipefail

# Read the JSON payload from stdin
INPUT=$(cat)

# Extract tool name and file path using Python (available everywhere)
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")
FILE_PATH=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
inp = d.get('tool_input', {})
# Write tool uses 'file_path'; Edit tool uses 'file_path'
print(inp.get('file_path', ''))
" 2>/dev/null || echo "")

# Only act on Write or Edit tool calls
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

# Only lint backend TypeScript files in the kwh package
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

if [[ ! "$FILE_PATH" =~ packages/kwh/backend/.*\.ts$ ]]; then
  exit 0
fi

# Resolve full path (FILE_PATH may be relative or absolute)
if [[ "$FILE_PATH" != /* ]]; then
  # Relative — resolve from repo root
  REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || echo "")"
  if [[ -z "$REPO_ROOT" ]]; then
    exit 0
  fi
  FILE_PATH="$REPO_ROOT/$FILE_PATH"
fi

# Confirm file exists
if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

BACKEND_DIR="$(dirname "$FILE_PATH")"
# Walk up to find backend/ directory
while [[ "$BACKEND_DIR" != "/" && "$(basename "$BACKEND_DIR")" != "backend" ]]; do
  BACKEND_DIR="$(dirname "$BACKEND_DIR")"
done

if [[ "$(basename "$BACKEND_DIR")" != "backend" ]]; then
  exit 0
fi

# Run ESLint with --fix; capture output
ESLINT_OUTPUT=$(cd "$BACKEND_DIR" && npx eslint --fix "$FILE_PATH" --format stylish 2>&1 || true)

# Only surface output if there are remaining warnings/errors after fix
if echo "$ESLINT_OUTPUT" | grep -qE "warning|error" 2>/dev/null; then
  echo "⚠️  ESLint (Sonar-aligned) found remaining issues in $(basename "$FILE_PATH"):"
  echo "$ESLINT_OUTPUT"
  echo ""
  echo "Please fix the above issues to keep the file Sonar-compliant."
fi
