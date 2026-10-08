# Duetto

Claude Code × Codex CLI, spec-driven. One idea in → independently researched, clarified, planned, challenged,
implemented and cross-reviewed features out, with every artifact on disk.

```
/duetto "add checkpoint reminders"        (Claude Code)
$duetto "add checkpoint reminders"        (Codex)
```

> Formerly **duet**. Existing `.duet/` folders are moved to `.duetto/` automatically the first time you run
> `duetto`; runs in progress carry on.

## How it works

- **`duetto`** (this repo) is a deterministic engine: state, worker launching (`claude -p`, `codex exec`), git
  worktrees, running checks, schema validation. It never synthesizes or decides.
- **Your session is the orchestrator.** When synthesis is needed the engine pauses (`needs_synthesis`); the
  `/duetto` skill has the session read both models' outputs, write the merge, and `duetto submit` it.
- **You decide** anything non-minor. Conflicts in requirements / architecture / security / constitution are always
  escalated to you, even if the host marked them resolved (bias guard — the host is one of the two models).

```
scan (C∥X) → decompose (host) → ⛔ approve split
per feature, in dependency order, on a stacked branch + worktree:
  research (C∥X) → rebuttal (C∥X) → synthesis (host)
  spec draft (host)
  clarify against the draft (C∥X) → merge (host) → ⛔ answers   × up to N rounds → spec revision (host)
  plan (C∥X) → rebuttal (C∥X) → synthesis (host) → ⛔ escalated conflicts → finalize (host)
  challenge (C∥X) → fold in (host) → ⛔ new ambiguities
  tasks DAG (host) → commit specs/NNN-slug/
  per task: implement (alternating C/X) → checks (engine) → review (other model, read-only) → … ≤3 rounds → ⛔
    (independent tasks with disjoint files_in_scope run concurrently, each in its own worktree, then merge in order)
  converge audit → ⛔ fix/accept → report.md
```

`--depth quick` skips rebuttals and challenge and does one clarify round; `deep` does three.

## Spec Kit

Duetto is built to sit on top of [GitHub Spec Kit](https://github.com/github/spec-kit). It follows the same phases
(specify → clarify → plan → tasks → implement → converge) and writes features to the same `specs/NNN-name/`
folders. In a project with `.specify/` (from `specify init`), duetto:

- gives every agent Spec Kit's constitution (`.specify/memory/constitution.md`);
- resolves templates through Spec Kit's own `resolve-template.sh`, so overrides, presets and extensions apply;
- numbers features the way Spec Kit's `create-new-feature.sh` does.

Without `.specify/`, duetto uses `.duetto/constitution.md` and bundled copies of Spec Kit's templates (MIT, see
`templates/speckit/LICENSE`). It never creates `.specify/` itself: run `specify init --here` for that.

## Watching Claude and Codex live

Every worker streams what it is doing: thinking, commands, files read or edited, searches. In cmux or tmux, `duetto run`
opens a Claude pane and a Codex pane beside the orchestrator automatically (`ui.panes`: `auto` | `cmux` | `tmux` |
`off`). Each pane closes itself when the run finishes. Anywhere else:

```sh
duetto watch                  # both agents, stacked, live
duetto watch --agent codex    # follow one agent
duetto watch --compact        # one line per activity, for pipes
duetto panes                  # reopen the panes
```

Transcripts live in `.duetto/runs/<run>/live/{claude,codex}.log`.

The orchestrating session never runs the engine in its own shell. `duetto run --detach` starts an independent
runner, and `duetto watch --milestones` follows it until it pauses. Every step line shows where the run is
(`step 12 · F1 1/2 · T003 3/7 · 1h04m elapsed`). While a step runs, a `⏱` heartbeat (`ui.heartbeat_seconds`, default
60) says what Claude and Codex are doing, and a `⚠` warning flags a worker that has been silent for
`ui.stall_minutes` (default 10).

## Install

Requires Node ≥ 20.17, `git`, and the `claude` and `codex` CLIs logged in. Nothing to `npm install`: the engine is
dependency-free and ships pre-built inside the skill.

**Claude Code**
```sh
claude plugin marketplace add bishoyngendy/duetto     # or a local path
claude plugin install duetto@duetto
```

**Codex CLI**
```sh
codex plugin marketplace add bishoyngendy/duetto      # or a local path
codex plugin add duetto@duetto
```

The repo is both a Claude Code marketplace (`.claude-plugin/marketplace.json`) and a Codex marketplace
(`.agents/plugins/marketplace.json`). Both point at `plugins/duetto/`, which contains one skill with the engine
bundled at `skills/duetto/engine/`.

Check the setup with `node <skill-dir>/engine/bin/duetto.mjs agent-test`: both CLIs must return valid output, be able to run
commands, and be unable to write in read-only mode.

### Developing

```sh
sh scripts/install.sh   # dev: links ~/.local/bin/duetto (runs src/*.ts directly) and the skill into both CLIs
npm run build           # src/*.ts → plugins/duetto/skills/duetto/engine/**/*.mjs (Node's built-in type stripping)
npm test                # suite against the sources (Node ≥ 22.18 / 23.6 for type stripping)
npm run test:built      # same suite against the built engine
```

Commit the build output: plugin installs pull from git and run no build step. CI fails if it is stale.

## In a project

```sh
duetto init     # .duetto/config.json (models, checks, protected paths) + constitution.md
```

Edit `checks.setup` (e.g. `pnpm install --frozen-lockfile`, run in each fresh worktree) and `checks.commands`
(typecheck/lint/test — run by the engine after every implementation round). Edit the constitution: every agent gets it.

Other useful settings in `config.json`:

- `agents.<claude|codex>.roles.<role>` sets `{ model, effort }` per role. By default the scan and question rounds run at `medium` effort for both models, and Codex also runs research, rebuttal, challenge and review at `medium` (it was the long pole of every parallel step); planning and implementation stay `high`.
- `parallel_tasks` (default `3`) caps how many independent tasks are implemented at once. Tasks join a wave only
  when their dependencies are done and their `files_in_scope` globs can't overlap; each gets its own worktree (running
  `checks.setup`), and its commit is cherry-picked onto the feature branch. A task that still conflicts is redone on top
  of the merged work. `1` keeps implementation strictly serial.
- `review.blocking` (default `critical/high/medium`) lists severities that force another round even if the reviewer approved.
- `review.polish` (default `low`) and `review.polish_rounds` (default `1`) control the polish round: when a review approves with these findings, the implementer addresses or disputes them in one extra round. That round is gated by the checks, not re-reviewed; if checks fail it goes back to review.
- `escalate_categories` lists conflict categories the host may never settle on its own.

Read-only roles can run commands (tests, probes) but can't write: Claude runs inside Claude Code's OS sandbox with the working tree write-denied, and Codex runs with `-s read-only`. Reviewers are also checked against a before/after snapshot of the worktree. `duetto agent-test` verifies both properties.

| Path | What | Git |
|---|---|---|
| `specs/NNN-slug/{spec,plan,tasks,research,decisions,report}.md` | human artifacts | committed on the feature branch |
| `.duetto/config.json`, `constitution.md` | project settings | commit them |
| `.duetto/runs/<run>/` | state, events, per-model JSON, raw agent I/O | ignored |
| `~/.duetto/worktrees/…` | one worktree per feature | — |

## CLI

```
duetto start "<idea>" [--depth quick|standard|deep] [--headless]
duetto run [--headless] [--detach] [--until <phase> [--feature F1]]
                               advance until host/user is needed (re-run after any failure; nothing is redone);
                               --until stops after specify|clarify|plan|tasks|analyze|implement|converge
duetto status [--json]
duetto next [--json]             pending synthesis task or questions
duetto submit <draft.json>
duetto answer Q1=B Q2="free text" [--accept-suggested]
duetto log | duetto runs | duetto use <run>
```

`--headless` lets `synthesizer_fallback` (default claude) do host steps, for unattended runs; question gates still wait for you.

## Tests

The suite uses `node:test`. Fake agents and a scripted host drive the full pipeline in real throwaway git repos,
against both the sources and the built engine.
