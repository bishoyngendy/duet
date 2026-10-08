---
name: duetto
description: Run a dual-model (Claude + Codex) spec-driven workflow on an idea - parallel research, clarifying questions, independent plans with rebuttal, adversarial plan challenge, task DAG, and alternating implement/review until converged. Use when the user invokes /duetto or $duetto, asks to "orchestrate", or wants an idea taken from spec to reviewed implementation by both Claude and Codex.
---

# Duetto — you are the orchestrator

## Running the engine
The engine ships inside this skill: `<skill-dir>/engine/bin/duetto.mjs`, where `<skill-dir>` is the directory
containing this SKILL.md (Claude Code prints it as "Base directory for this skill"). Throughout this file,
`duetto` means `node "<skill-dir>/engine/bin/duetto.mjs"` — if an `duetto` command is already on PATH, you may use it.
Requires Node ≥ 20.17, git, and the `claude` and `codex` CLIs logged in. Run `duetto agent-test` once if unsure.

`duetto` is a local CLI engine. It launches Claude (`claude -p`) and Codex (`codex exec`) as independent workers,
stores every artifact under `.duetto/runs/<run>/` and `specs/NNN-slug/`, runs git/tests deterministically, and
pauses whenever it needs **you** (synthesis) or **the user** (decisions). You never do the research, planning or
implementation yourself — the workers do. Your jobs: drive the loop, synthesize faithfully, ask the user well.

## Spec Kit-style commands
Users who know Spec Kit can drive one phase at a time; each runs both models for that phase, then stops (`paused`):
- `duetto specify "<description>"`: new single feature; research and a spec draft.
- `duetto clarify`, `duetto plan`, `duetto tasks`, `duetto analyze`, `duetto implement`, `duetto converge`: take the
  current feature to the end of that phase. The feature comes from `--feature <NNN|slug|specs/dir>`, then
  `SPECIFY_FEATURE_DIRECTORY` / `SPECIFY_FEATURE`, then `.specify/feature.json`, the branch, or the current run.
- The phase target is remembered: after a synthesis or answers pause, `duetto run --detach` still stops at it.
- Users may edit `spec.md` / `plan.md` / `tasks.md` by hand between commands. Before implementation, the next command
  asks you (host step "apply your edits to …") to fold the edit into the JSON; later phases are then redone.
- A spec written with plain `/speckit-specify` is adopted automatically by the next phase command (via
  `.specify/feature.json` or `--feature`): the first host step imports its spec.md faithfully.
Map the user's words to these ("plan it", "/speckit-plan but with both models" → `duetto plan`). `duetto start` is
the autopilot: every phase, and possibly several features.

## Start or resume
- New idea: `duetto start "<idea>" --detach [--depth quick|standard|deep]` (standard by default; quick skips rebuttals and the
  challenge phase — suggest quick for small changes, deep for risky ones). First time in a repo it runs `duetto init`;
  tell the user to review `.duetto/config.json` (`checks.setup`, `checks.commands`) and the constitution file `init`
  names. In a Spec Kit project (`.specify/` exists) duetto uses Spec Kit's constitution and templates. If there is no
  `.specify/` but `specify` is on PATH, offer `specify init --here --integration claude` (or `codex`) first. Never run
  it without the user's yes.
- Existing run: `duetto status`, then `duetto run --detach`.

## Driving the run
Read `<skill-dir>/reference/loop.md` and follow it exactly: how to advance a run (always `--detach`), follow it with
`duetto watch --milestones` (Monitor in Claude Code), keep the user informed, and act on every status: synthesis,
questions, failures, interruptions, pauses and completion.
