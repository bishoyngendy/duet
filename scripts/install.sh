#!/bin/sh
# Link `orch` onto PATH and install the shared skill for Claude Code and Codex.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${ORCH_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN" "$HOME/.claude/skills" "$HOME/.agents/skills"
chmod +x "$ROOT/bin/orch.js"
ln -sfn "$ROOT/bin/orch.js" "$BIN/orch"
ln -sfn "$ROOT/skills/orchestra" "$HOME/.claude/skills/orchestra"
ln -sfn "$ROOT/skills/orchestra" "$HOME/.agents/skills/orchestra"
echo "orch          -> $BIN/orch"
echo "Claude skill  -> ~/.claude/skills/orchestra  (/orchestra)"
echo "Codex skill   -> ~/.agents/skills/orchestra  (\$orchestra)"
