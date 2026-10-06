# orchestra

Claude Code × Codex CLI, spec-driven. One idea in → independently researched, clarified, planned, challenged,
implemented and cross-reviewed features out, with every artifact on disk.

```
/orchestra "add checkpoint reminders"        (Claude Code)
$orchestra "add checkpoint reminders"        (Codex)
```

## How it works

- **`orch`** (this repo) is a deterministic engine: state, worker launching (`claude -p`, `codex exec`), git
  worktrees, running checks, schema validation. It never synthesizes or decides.
- **Your session is the orchestrator.** When synthesis is needed the engine pauses (`needs_synthesis`); the
  `/orchestra` skill has the session read both models' outputs, write the merge, and `orch submit` it.
- **You decide** anything non-minor. Conflicts in requirements / architecture / security / constitution are always
  escalated to you, even if the host marked them resolved (bias guard — the host is one of the two models).

```
scan (C∥X) → decompose (host) → ⛔ approve split
per feature, in dependency order, on a stacked branch + worktree:
  research (C∥X) → rebuttal (C∥X) → synthesis (host)
  clarify (C∥X) → merge (host) → ⛔ answers        × up to N rounds
  spec (host)
  plan (C∥X) → rebuttal (C∥X) → synthesis (host) → ⛔ escalated conflicts → finalize (host)
  challenge (C∥X) → fold in (host) → ⛔ new ambiguities
  tasks DAG (host) → commit specs/NNN-slug/
  per task: implement (alternating C/X) → checks (engine) → review (other model, read-only) → … ≤3 rounds → ⛔
  converge audit → ⛔ fix/accept → report.md
```

`--depth quick` skips rebuttals and challenge and does one clarify round; `deep` does three.

## Install

Requires Node ≥ 20.17, `git`, and the `claude` and `codex` CLIs logged in. Nothing to `npm install`: the engine is
dependency-free and ships pre-built inside the skill.

**Claude Code**
```sh
claude plugin marketplace add <owner>/orchestra     # or a local path
claude plugin install orchestra@orchestra
```

**Codex CLI**
```sh
codex plugin marketplace add <owner>/orchestra      # or a local path
codex plugin add orchestra@orchestra
```

The repo is both a Claude Code marketplace (`.claude-plugin/marketplace.json`) and a Codex marketplace
(`.agents/plugins/marketplace.json`). Both point at `plugins/orchestra/`, which contains one skill with the engine
bundled at `skills/orchestra/engine/`.

Check the setup with `node <skill-dir>/engine/bin/orch.mjs agent-test`: both CLIs must return valid output, be able to run
commands, and be unable to write in read-only mode.

### Developing

```sh
sh scripts/install.sh   # dev: links ~/.local/bin/orch (runs src/*.ts directly) and the skill into both CLIs
npm run build           # src/*.ts → plugins/orchestra/skills/orchestra/engine/**/*.mjs (Node's built-in type stripping)
npm test                # suite against the sources (Node ≥ 22.18 / 23.6 for type stripping)
npm run test:built      # same suite against the built engine
```

Commit the build output: plugin installs pull from git and run no build step. CI fails if it is stale.

## In a project

```sh
orch init     # .orchestra/config.json (models, checks, protected paths) + constitution.md
```

Edit `checks.setup` (e.g. `pnpm install --frozen-lockfile`, run in each fresh worktree) and `checks.commands`
(typecheck/lint/test — run by the engine after every implementation round). Edit the constitution: every agent gets it.

Other useful settings in `config.json`:

- `agents.<claude|codex>.roles.<role>` sets `{ model, effort }` per role. By default the scan and question rounds run at `medium` effort.
- `review.blocking` (default `critical/high/medium`) lists severities that force another round even if the reviewer approved.
- `review.polish` (default `low`) and `review.polish_rounds` (default `1`) control the polish round: when a review approves with these findings, the implementer addresses or disputes them in one extra round.
- `escalate_categories` lists conflict categories the host may never settle on its own.

Read-only roles can run commands (tests, probes) but can't write: Claude runs inside Claude Code's OS sandbox with the working tree write-denied, and Codex runs with `-s read-only`. Reviewers are also checked against a before/after snapshot of the worktree. `orch agent-test` verifies both properties.

| Path | What | Git |
|---|---|---|
| `specs/NNN-slug/{spec,plan,tasks,research,decisions,report}.md` | human artifacts | committed on the feature branch |
| `.orchestra/config.json`, `constitution.md` | project settings | commit them |
| `.orchestra/runs/<run>/` | state, events, per-model JSON, raw agent I/O | ignored |
| `~/.orchestra/worktrees/…` | one worktree per feature | — |

## CLI

```
orch start "<idea>" [--depth quick|standard|deep] [--headless]
orch run [--headless]          advance until host/user is needed (re-run after any failure; nothing is redone)
orch status [--json]
orch next [--json]             pending synthesis task or questions
orch submit <draft.json>
orch answer Q1=B Q2="free text" [--accept-suggested]
orch log | orch runs | orch use <run>
```

`--headless` lets `synthesizer_fallback` (default claude) do host steps, for unattended runs; question gates still wait for you.

## Tests

The suite uses `node:test`. Fake agents and a scripted host drive the full pipeline in real throwaway git repos,
against both the sources and the built engine.
