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

## Start or resume
- New idea: `duetto start "<idea>" --detach [--depth quick|standard|deep]` (standard by default; quick skips rebuttals and the
  challenge phase — suggest quick for small changes, deep for risky ones). First time in a repo it runs `duetto init`;
  tell the user to review `.duetto/config.json` (`checks.setup`, `checks.commands`) and `.duetto/constitution.md`.
- Existing run: `duetto status`, then `duetto run --detach`.

## Advancing and following a run
Steps take minutes (each worker call is a full agent session), so never run `duetto run` in the foreground of your
shell. Instead:
1. `duetto run --detach` (or `duetto start "<idea>" --detach`) starts the runner in its own process and returns at
   once. It keeps going even if your shell command times out or this session ends.
2. Follow it with `duetto watch --milestones`: it prints each step as it starts (with `step N · task 3/7 · elapsed`),
   a `⏱` heartbeat about once a minute saying what Claude and Codex are doing, any `⚠` stall warning, and exits when
   the run pauses or ends, with a final `■ <status>` line.
   - In Claude Code, run it with the **Monitor** tool so each line reaches you as it happens. If Monitor's deadline
     ends first, start it again: the run itself was never interrupted.
   - Without Monitor (e.g. Codex), run it as a background/long command and wait for it to exit; re-run it if your
     shell times it out.
3. While it runs, give the user a one-line update when a phase starts or finishes, or every few minutes on long
   steps (e.g. "Implementing T003 (3/7) — Codex is running the tests, 6 min in"). Don't relay every heartbeat.
4. When it exits, act on the final status (below).

The runner spawns `claude`/`codex` (network) and create worktrees under `~/.duetto/worktrees` — if your shell sandbox
blocks that, re-run the command outside the sandbox / with escalated permissions.

## Live views
The first runner that starts a worker opens a live Claude pane and a live Codex pane beside this session when
it runs inside cmux or tmux. Its first output line says whether it did. Tell the user once where to look: "live
Claude/Codex panes are open on the right", or "run `duetto watch` in another terminal to follow Claude and Codex
live". `duetto panes` reopens them if they were closed.

## The loop
When `duetto watch --milestones` exits, run `duetto status --json` and act on `status`:

1. **needs_synthesis** → `duetto next --json` gives `instructions`, `inputs` (file paths), `schema_path`, `draft_path`.
   - Read the instructions and EVERY input file completely. Read the schema.
   - Do the synthesis yourself, carefully. You may inspect the repo to verify a disputed claim.
   - You are one of the two models being compared — don't favour your own family. Only minor conflicts
     (equivalent / implementation / performance / risk) may be resolved by you; requirements, architecture,
     security and constitution conflicts must be `needs_user` with options. The engine enforces this anyway.
   - Write the JSON to `draft_path`, then `duetto submit <draft_path>`. If it reports validation errors, fix and resubmit.
   - Then `duetto run --detach` again and follow it.

2. **needs_answers** → `duetto next --json` gives `questions` (and `context` files worth summarising first).
   - Present them to the user. In Claude Code use AskUserQuestion (up to 4 questions per call; batch the rest):
     label each option by its key+label, put Claude's and Codex's recommendations and rationale in the
     description, mark the `suggested` option "(Recommended)" and list it first. In Codex, print a numbered
     list with the same information and ask the user to reply.
   - Never answer on the user's behalf. Free-text answers are allowed (pass them verbatim).
   - Record: `duetto answer Q1=A Q2="free text" …` (quote values with spaces). If the user says "go with the
     recommendations", use `--accept-suggested` (only fills questions that have a suggestion).
   - Then `duetto run --detach` again and follow it.

3. **failed** → show `message` and the last lines of `duetto log`; diagnose (missing tool, failing setup command,
   agent timeout, schema failure — raw agent output is under `.duetto/runs/<run>/raw/`). Fix the cause with the
   user, then `duetto run --detach` (completed steps are never redone).

4. **interrupted** → the `duetto run` process died mid-step (its session ended, it was killed, the machine slept).
   Tell the user in one line and `duetto run --detach` again; the in-flight step restarts, nothing else is redone.
   **running** means a runner is alive: just follow it with `duetto watch --milestones` (`--detach` refuses to start
   a second one).

5. **done** → summarise per feature from `duetto status`: branch, worktree, `specs/NNN-*/report.md` (tasks,
   implementer/reviewer, rounds, acceptance). Offer to open PRs (`gh pr create` from the worktree, base = the
   previous feature's branch for stacked features) — only if the user agrees.

Keep the user informed with one short line per phase (e.g. "Research done — Claude and Codex disagree on X;
synthesizing"). Don't paste whole artifacts; link the markdown files under `specs/`.
