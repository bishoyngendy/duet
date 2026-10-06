#!/bin/sh
# Dev install: link `duet` (TypeScript sources) onto PATH and the plugin skill into Claude Code and Codex.
# End users install the plugin instead — see README.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${DUET_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$BIN" "$HOME/.claude/skills" "$HOME/.agents/skills"
chmod +x "$ROOT/bin/duet.js"
ln -sfn "$ROOT/bin/duet.js" "$BIN/duet"
ln -sfn "$ROOT/plugins/duet/skills/duet" "$HOME/.claude/skills/duet"
ln -sfn "$ROOT/plugins/duet/skills/duet" "$HOME/.agents/skills/duet"
echo "duet          -> $BIN/duet"
echo "Claude skill  -> ~/.claude/skills/duet  (/duet)"
echo "Codex skill   -> ~/.agents/skills/duet  (\$duet)"
