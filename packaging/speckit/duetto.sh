#!/usr/bin/env bash
# Runs the Duetto engine for Spec Kit's speckit.duetto.* commands. The engine ships with the duetto plugin for
# Claude Code / Codex; this finds it: $DUETTO_BIN, `duetto` on PATH, then the plugin install locations.
set -euo pipefail
find_engine() {
  if [[ -n "${DUETTO_BIN:-}" ]]; then echo "$DUETTO_BIN"; return; fi
  if command -v duetto >/dev/null 2>&1; then command -v duetto; return; fi
  local candidates=(
    "$HOME"/.claude/plugins/cache/duetto/duetto/*/skills/duetto/engine/bin/duetto.mjs
    "$HOME"/.codex/plugins/cache/duetto/duetto/*/skills/duetto/engine/bin/duetto.mjs
    "$HOME"/.claude/skills/duetto/engine/bin/duetto.mjs
    "$HOME"/.agents/skills/duetto/engine/bin/duetto.mjs
  )
  local found=""
  for c in "${candidates[@]}"; do [[ -f "$c" ]] && found="$c"; done
  [[ -n "$found" ]] && echo "$found"
}
engine="$(find_engine || true)"
if [[ -z "$engine" ]]; then
  echo "Duetto engine not found. Install the duetto plugin:" >&2
  echo "  claude plugin marketplace add bishoyngendy/duetto && claude plugin install duetto@duetto" >&2
  echo "or set DUETTO_BIN to .../skills/duetto/engine/bin/duetto.mjs" >&2
  exit 127
fi
case "$engine" in
  *.mjs) exec node "$engine" "$@" ;;
  *) exec "$engine" "$@" ;;
esac
