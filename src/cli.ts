import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { createAgents, runAgent } from './agents/index.ts';
import { DEFAULT_CONFIG, detectChecks, loadConfig, type Depth } from './config.ts';
import { advance, answer, costSummary, gateView, hostTaskView, locate, submit, type Until } from './engine.ts';
import { currentBranch, git, head, repoRoot } from './git.ts';
import { liveDir } from './live.ts';
import { openPanes } from './panes.ts';
import { PHASES, type Ctx, type Phase } from './pipeline.ts';
import { constitutionPath, detect } from './speckit.ts';
import { runnerLog, watch } from './watch.ts';
import { SCHEMAS, type AgentName } from './schemas.ts';
import { currentRunId, listRuns, loadState, lockHolder, logEvent, migrateLegacy, newRunId, duettoDir, runDir, saveState, setCurrentRun, type RunState } from './state.ts';
import { exists, fmtMs, readJson, readText, writeJson, writeText } from './util.ts';

const HELP = `duetto — Claude × Codex spec-driven orchestrator

Usage:
  duetto init                         Scaffold .duetto/ (config, constitution) in this repo
  duetto start "<idea>" [--depth quick|standard|deep] [--headless] [--no-run] [--detach]
  duetto run [--headless] [--detach] [--until <phase> [--feature F1]]
                                      Advance the current run until it needs the host or you
                                      (--until: stop after a phase: specify|clarify|plan|tasks|analyze|implement|converge)
                                      (--detach: in the background, independent of this shell)
  duetto status [--json]              Where the run is, what's pending, cost so far
  duetto next [--json]                The pending host task (synthesis) or questions for you
  duetto submit <file.json>           Submit the host's synthesis for the pending step
  duetto answer Q1=A Q2="free text" [--accept-suggested] [--file answers.json]
  duetto watch [--agent claude|codex] [--compact]   Live view of what Claude and Codex are doing
  duetto watch --milestones           Follow a detached run's progress; exits when it pauses or ends
  duetto panes                        (Re)open live Claude/Codex panes in cmux or tmux
  duetto log [-n 40]                  Recent events
  duetto runs                         List runs;  duetto use <run-id> to switch
  duetto agent-test [--agent claude|codex]   Smoke-test both CLIs (schema output + read-only)

Common flags: --run <id> to target a specific run.
`;

const stamp = () => new Date().toTimeString().slice(0, 8);

/** The repo root, after moving a pre-rename `.duet/` folder to `.duetto/`. */
async function projectRoot(): Promise<string> {
  const repo = await repoRoot(process.cwd());
  if (migrateLegacy(repo)) console.log('Moved .duet/ to .duetto/ (duet is now Duetto); existing runs carry on.');
  return repo;
}

async function context(runId?: string): Promise<Ctx> {
  const repo = await projectRoot();
  const id = runId ?? currentRunId(repo);
  if (!id) throw new Error('No current run. Start one with: duetto start "<idea>"');
  const dir = runDir(repo, id);
  if (!exists(join(dir, 'state.json'))) throw new Error(`Run not found: ${id}`);
  const config = loadConfig(repo);
  return { repo, dir, config, state: loadState(dir), agents: createAgents(config), print: (l) => console.log(`[${stamp()}] ${l}`) };
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const { values: v, positionals: pos } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      run: { type: 'string' },
      depth: { type: 'string' },
      headless: { type: 'boolean' },
      'no-run': { type: 'boolean' },
      json: { type: 'boolean' },
      file: { type: 'string' },
      'accept-suggested': { type: 'boolean' },
      agent: { type: 'string' },
      n: { type: 'string', short: 'n' },
      force: { type: 'boolean' },
      compact: { type: 'boolean' },
      milestones: { type: 'boolean' },
      detach: { type: 'boolean' },
      until: { type: 'string' },
      feature: { type: 'string' },
    },
  });

  switch (cmd) {
    case 'init':
      return init(Boolean(v.force));
    case 'start': {
      const idea = pos.join(' ').trim();
      if (!idea) throw new Error('Usage: duetto start "<idea>"');
      const ctx = await start(idea, (v.depth as Depth) ?? undefined);
      if (v['no-run']) return 0;
      if (v.detach) return detach(ctx, Boolean(v.headless));
      return exitFor(await advance(ctx, { headless: v.headless, panes: !v.headless }));
    }
    case 'run': {
      const ctx = await context(v.run);
      const until = parseUntil(v.until, v.feature);
      if (v.detach) return detach(ctx, Boolean(v.headless), until);
      return exitFor(await advance(ctx, { headless: v.headless, panes: !v.headless, until }));
    }
    case 'watch': {
      const ctx = await context(v.run);
      return watch(ctx.dir, { agent: v.agent, compact: v.compact, milestones: v.milestones });
    }
    case 'panes': {
      const ctx = await context(v.run);
      rmSync(join(liveDir(ctx.dir), 'panes.json'), { force: true });
      const mode = ctx.config.ui.panes === 'off' ? 'auto' : ctx.config.ui.panes;
      console.log(await openPanes({ dir: ctx.dir, repo: ctx.repo, runId: ctx.state.id, mode }));
      return 0;
    }
    case 'status':
      return status(await context(v.run), Boolean(v.json));
    case 'next':
      return next(await context(v.run), Boolean(v.json));
    case 'submit': {
      if (!pos[0]) throw new Error('Usage: duetto submit <file.json>');
      const ctx = await context(v.run);
      const step = await submit(ctx, pos[0]);
      console.log(`✓ accepted ${step.id}. Continue with: duetto run`);
      return 0;
    }
    case 'answer': {
      const ctx = await context(v.run);
      const given: Record<string, string> = v.file ? readJson(v.file) : {};
      for (const kv of pos) {
        const i = kv.indexOf('=');
        if (i < 1) throw new Error(`Expected ID=answer, got "${kv}"`);
        given[kv.slice(0, i)] = kv.slice(i + 1);
      }
      const answers = await answer(ctx, given, Boolean(v['accept-suggested']));
      for (const a of answers) console.log(`✓ ${a.id} → ${a.label}`);
      console.log('Continue with: duetto run');
      return 0;
    }
    case 'log': {
      const ctx = await context(v.run);
      const lines = readText(join(ctx.dir, 'events.jsonl')).trim().split('\n').filter(Boolean);
      for (const l of lines.slice(-Number(v.n ?? 40))) console.log(l);
      return 0;
    }
    case 'runs': {
      const repo = await projectRoot();
      const cur = currentRunId(repo);
      for (const id of listRuns(repo)) {
        const s = loadState(runDir(repo, id));
        console.log(`${id === cur ? '*' : ' '} ${id}  ${s.status.padEnd(16)} ${s.request.slice(0, 60)}`);
      }
      return 0;
    }
    case 'use': {
      const repo = await projectRoot();
      if (!pos[0] || !exists(runDir(repo, pos[0]))) throw new Error('Usage: duetto use <run-id> (see duetto runs)');
      setCurrentRun(repo, pos[0]);
      return 0;
    }
    case 'agent-test':
      return agentTest(v.agent as AgentName | undefined);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      return 2;
  }
}

const exitFor = (s: RunState['status']) => (s === 'failed' ? 1 : 0);

/**
 * Starts `duetto run` as its own process group with output to live/runner.log, and returns at once. The run
 * then survives the shell or session that started it; `duetto watch --milestones` follows it.
 */
function parseUntil(phase?: string, feature?: string): Until | undefined {
  if (!phase) {
    if (feature) throw new Error('--feature needs --until <phase>');
    return undefined;
  }
  if (!PHASES.includes(phase as Phase)) throw new Error(`--until must be one of: ${PHASES.join(', ')}`);
  return { phase: phase as Phase, feature };
}

function detach(ctx: Ctx, headless: boolean, until?: Until): number {
  const holder = lockHolder(ctx.dir);
  if (holder) {
    console.log(`Already running (pid ${holder}). Follow it with: duetto watch --milestones`);
    return 0;
  }
  mkdirSync(liveDir(ctx.dir), { recursive: true });
  const log = openSync(runnerLog(ctx.dir), 'a');
  const args = [
    process.argv[1],
    'run',
    '--run',
    ctx.state.id,
    ...(headless ? ['--headless'] : []),
    ...(until ? ['--until', until.phase, ...(until.feature ? ['--feature', until.feature] : [])] : []),
  ];
  const child = spawn(process.execPath, args, { cwd: ctx.repo, detached: true, stdio: ['ignore', log, log], env: process.env });
  // Claim the lock for the child now, so a watcher started right after this sees a live runner.
  writeText(join(ctx.dir, 'run.lock'), String(child.pid));
  child.unref();
  console.log(`Runner started (pid ${child.pid}). Follow it with: duetto watch --milestones`);
  return 0;
}

async function init(force: boolean): Promise<number> {
  const repo = await projectRoot();
  const dir = duettoDir(repo);
  const cfgPath = join(dir, 'config.json');
  const constPath = join(dir, 'constitution.md');
  if (!exists(cfgPath) || force) {
    writeJson(cfgPath, { ...DEFAULT_CONFIG, checks: detectChecks(repo) });
    console.log(`wrote ${cfgPath}`);
  }
  const sk = detect(repo);
  if (sk.present && exists(join(repo, '.specify', 'memory', 'constitution.md'))) {
    console.log(`Spec Kit project${sk.integration ? ` (${sk.integration})` : ''}: using its constitution at .specify/memory/constitution.md`);
  } else if (!exists(constPath) || force) {
    writeText(constPath, readFileSync(join(import.meta.dirname, '..', 'templates', 'constitution.md'), 'utf8'));
    console.log(`wrote ${constPath}`);
  }
  const gi = join(repo, '.gitignore');
  const lines = ['.duetto/runs/', '.duetto/current', '.duetto/host/'];
  const current = readText(gi);
  const missing = lines.filter((l) => !current.split('\n').includes(l));
  if (missing.length) {
    writeText(gi, current + (current && !current.endsWith('\n') ? '\n' : '') + `# duetto\n${missing.join('\n')}\n`);
    console.log('updated .gitignore');
  }
  const constitutionFile = relative(repo, constitutionPath(repo));
  console.log(`\nReview .duetto/config.json (checks.setup / checks.commands) and ${constitutionFile}, then: duetto start "<idea>"`);
  return 0;
}

async function start(idea: string, depth?: Depth): Promise<Ctx> {
  const repo = await projectRoot();
  if (!exists(join(duettoDir(repo), 'config.json'))) await init(false);
  const config = loadConfig(repo);
  const dirty = await git(repo, 'status', '--porcelain');
  if (dirty.split('\n').some((l) => l && !l.includes('.duetto') && !l.endsWith('.gitignore'))) {
    console.log('⚠ Working tree has uncommitted changes. Worktrees branch from HEAD, so those changes will NOT be visible to the agents.');
  }
  const id = newRunId(idea);
  const dir = runDir(repo, id);
  const now = new Date().toISOString();
  const state: RunState = {
    id,
    request: idea,
    depth: depth ?? config.depth,
    status: 'idle',
    step: null,
    message: null,
    base_commit: await head(repo),
    base_branch: await currentBranch(repo),
    created_at: now,
    updated_at: now,
  };
  if (!['quick', 'standard', 'deep'].includes(state.depth)) throw new Error(`Invalid depth ${state.depth}`);
  writeText(join(dir, 'request.md'), idea + '\n');
  saveState(dir, state);
  setCurrentRun(repo, id);
  logEvent(dir, { type: 'start', request: idea, depth: state.depth });
  console.log(`run ${id} (depth ${state.depth})`);
  return { repo, dir, config, state, agents: createAgents(config), print: (l) => console.log(`[${stamp()}] ${l}`) };
}

function status(ctx: Ctx, json: boolean): number {
  const { step, done } = safe(() => locate(ctx), { step: null, done: [] });
  const costs = costSummary(ctx.dir);
  const featuresDir = join(ctx.dir, 'features');
  const features = exists(featuresDir)
    ? readdirSync(featuresDir)
        .filter((f) => exists(join(featuresDir, f, 'feature.json')))
        .map((f) => readJson(join(featuresDir, f, 'feature.json')))
    : [];
  const pending = step?.kind === 'host' && ctx.state.status === 'needs_synthesis' ? hostTaskView(ctx, step) : step?.kind === 'user' ? gateView(ctx, step) : null;
  if (json) {
    console.log(
      JSON.stringify(
        { run: ctx.state.id, request: ctx.state.request, depth: ctx.state.depth, status: ctx.state.status, message: ctx.state.message, current_step: step && { id: step.id, title: step.title, kind: step.kind }, completed_steps: done.map((d) => d.id), pending, features, costs },
        null,
        2,
      ),
    );
    return 0;
  }
  console.log(`Run      ${ctx.state.id}  (depth ${ctx.state.depth})`);
  console.log(`Request  ${ctx.state.request}`);
  console.log(`Status   ${ctx.state.status}${ctx.state.message ? ` — ${ctx.state.message}` : ''}\n`);
  const shown = done.slice(-12);
  if (done.length > shown.length) console.log(`  ✓ … ${done.length - shown.length} earlier steps`);
  for (const d of shown) console.log(`  ✓ ${d.title}`);
  if (step) console.log(`  ${step.kind === 'user' ? '?' : step.kind === 'host' ? '◆' : '●'} ${step.title}`);
  for (const f of features) console.log(`\n  ${f.id} ${f.title}\n     branch   ${f.branch}\n     worktree ${f.worktree}\n     specs    ${f.specDir}`);
  const costLine = Object.entries(costs).map(([a, c]) => `${a}: ${c.calls} calls, ${fmtMs(c.ms)}${c.cost ? `, $${c.cost.toFixed(2)}` : ''}`);
  if (costLine.length) console.log(`\nAgents   ${costLine.join(' · ')}`);
  const hint = { needs_synthesis: 'duetto next', needs_answers: 'duetto next', idle: 'duetto run', failed: 'duetto run (after fixing the cause)', running: 'duetto log', paused: 'duetto run (continues past the phase it stopped at)', interrupted: 'duetto run (resumes where it stopped)', done: '' }[ctx.state.status];
  if (hint) console.log(`\nNext     ${hint}`);
  return 0;
}

function next(ctx: Ctx, json: boolean): number {
  const { step } = locate(ctx);
  if (!step) {
    console.log(json ? JSON.stringify({ kind: 'done' }) : 'Run complete — nothing pending.');
    return 0;
  }
  if (step.kind === 'host') {
    const view = hostTaskView(ctx, step);
    if (json) console.log(JSON.stringify(view, null, 2));
    else {
      console.log(`◆ HOST STEP: ${view.title}\n\n${view.instructions}\n\nInputs:`);
      for (const [k, p] of Object.entries(view.inputs)) console.log(`  ${k}: ${p}`);
      console.log(`\nOutput schema: ${view.schema_path}\nWrite your JSON to: ${view.draft_path}\nThen: duetto submit ${view.draft_path}`);
    }
    return 0;
  }
  if (step.kind === 'user') {
    const view = gateView(ctx, step);
    if (json) console.log(JSON.stringify(view, null, 2));
    else {
      console.log(`? ${view.title}${view.context.length ? `\n  context: ${view.context.join(', ')}` : ''}\n`);
      for (const q of view.questions) {
        console.log(`[${q.id}]${q.blocking ? ' (blocking)' : ''} ${q.text}`);
        for (const o of q.options) console.log(`    ${o.key}) ${o.label} — ${o.description}${o.key === q.suggested ? '  ← suggested' : ''}`);
        if (q.claude) console.log(`    Claude → ${q.claude.recommendation ?? '—'}: ${q.claude.rationale}`);
        if (q.codex) console.log(`    Codex  → ${q.codex.recommendation ?? '—'}: ${q.codex.rationale}`);
        console.log('');
      }
      console.log(`Answer: duetto answer ${view.questions.map((q) => `${q.id}=<key|text>`).join(' ')}  [--accept-suggested]`);
    }
    return 0;
  }
  console.log(json ? JSON.stringify({ kind: 'engine', step: step.id, title: step.title }) : `● ${step.title} — engine work; run: duetto run`);
  return 0;
}

async function agentTest(only?: AgentName): Promise<number> {
  const config = loadConfig(await projectRoot().catch(() => process.cwd()));
  const agents = createAgents(config);
  let failed = 0;
  for (const name of (only ? [only] : ['claude', 'codex']) as AgentName[]) {
    const cwd = mkdtempSync(join(tmpdir(), `duetto-test-${name}-`));
    const started = Date.now();
    try {
      const res = await runAgent(agents[name], {
        role: 'tester',
        prompt:
          'Capability test. (1) Run this shell command and report its exact stdout as command_output: node -e "console.log(6*7)" ' +
          '(2) Try to create a file named probe.txt containing "x" in the current directory, using any tool including the shell (it is fine if this is not permitted). ' +
          'Respond with ok=true, your model name, command_output, and wrote_file set to whether creating the file succeeded.',
        cwd,
        writable: false,
        schema: SCHEMAS.AgentTest,
        rawDir: join(cwd, 'raw'),
        label: 'agent-test',
        timeoutMs: 5 * 60_000,
      });
      const leaked = exists(join(cwd, 'probe.txt'));
      const ran = res.output.command_output.trim() === '42';
      const ok = res.output.ok && !leaked && ran;
      if (!ok) failed++;
      console.log(
        `${ok ? '✓' : '✖'} ${name} (${config.agents[name].model}) ${fmtMs(Date.now() - started)} → ${JSON.stringify(res.output)}` +
          `\n    ${ran ? '✓ can run commands' : '✖ could NOT run commands'} · ${leaked ? '✖ READ-ONLY VIOLATED: probe.txt was written' : '✓ read-only enforced'}`,
      );
    } catch (err) {
      failed++;
      console.log(`✖ ${name}: ${(err as Error).message}\n  raw output: ${join(cwd, 'raw')}`);
    }
  }
  return failed ? 1 : 0;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
