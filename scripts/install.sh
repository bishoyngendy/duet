#!/bin/sh
# Dev install: link `duetto` (TypeScript sources) onto PATH and the plugin skill into Claude Code and Codex.
# End users install the plugin instead — see README.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${DUETTO_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN" "$HOME/.claude/skills" "$HOME/.agents/skills"
chmod +x "$ROOT/bin/duetto.js"
ln -sfn "$ROOT/bin/duetto.js" "$BIN/duetto"
ln -sfn "$ROOT/plugins/duetto/skills/duetto" "$HOME/.claude/skills/duetto"
ln -sfn "$ROOT/plugins/duetto/skills/duetto" "$HOME/.agents/skills/duetto"
echo "duetto        -> $BIN/duetto"
echo "Claude skill  -> ~/.claude/skills/duetto  (/duetto)"
echo "Codex skill   -> ~/.agents/skills/duetto  (\$duetto)"
