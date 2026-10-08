import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { AgentCall, AgentOutput } from '../src/agents/types.ts';
import { live, progress, watchMod } from './impl.ts';
import { FakeAgent, gitRepo, makeRun } from './helpers.ts';
import { engine } from './impl.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'duetto-progress-'));

test('progressNote names the step, feature and task position, and elapsed time', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'decomposition.json'), JSON.stringify({ features: [{ id: 'F1' }, { id: 'F2' }] }));
  mkdirSync(join(dir, 'features', 'F2'), { recursive: true });
  writeFileSync(join(dir, 'features', 'F2', 'tasks.json'), JSON.stringify({ tasks: [{ id: 'T001' }, { id: 'T002' }, { id: 'T003' }] }));
  const created = '2026-10-08T10:00:00Z';
  const at = Date.parse('2026-10-08T11:04:30Z');
  assert.equal(progress.progressNote(dir, 'scan', 1, created, at), 'step 1 · 1h04m elapsed');
  assert.equal(progress.progressNote(dir, 'F2/T002/r1/implement', 40, created, at), 'step 40 · F2 2/2 · T002 2/3 · 1h04m elapsed');
  assert.equal(progress.progressNote(dir, 'F2/T003-rerun/r1/implement', 41, created, Date.parse('2026-10-08T10:02:05Z')), 'step 41 · F2 2/2 · T003-rerun 3/3 · 2m05s elapsed');
});

test('heartbeat line shows what each in-flight call is doing and warns once about silence', () => {
  const dir = tmp();
  const c = live.liveCall(dir, 'codex', { label: 'x', step: 'F1/research', role: 'researcher' });
  c.onActivity({ kind: 'command', text: 'rg --files android/app' });
  const warned = new Set<string>();
  const now = Date.now();
  const line = progress.heartbeatLine(dir, 'F1/research', now - 250_000, 600_000, warned, now);
  assert.equal(line, '⏱ F1/research 4m10s · codex: $ rg --files android/app (1 ev)');
  const later = now + 11 * 60_000;
  assert.match(progress.heartbeatLine(dir, 'F1/research', now, 600_000, warned, later), /\n⚠ codex has been silent for 11m\d\ds on F1\/research/);
  assert.doesNotMatch(progress.heartbeatLine(dir, 'F1/research', now, 600_000, warned, later + 60_000), /⚠/, 'warned once per call');
});

class SlowAgent extends FakeAgent {
  async invoke(call: AgentCall): Promise<AgentOutput> {
    await new Promise((r) => setTimeout(r, 300));
    return super.invoke(call);
  }
}

test('a running step prints heartbeats and a progress note', async () => {
  const repo = gitRepo();
  const ctx = makeRun(repo, { claude: new SlowAgent('claude'), codex: new SlowAgent('codex') });
  ctx.config.ui = { panes: 'off', heartbeat_seconds: 0.1, stall_minutes: 10 };
  const lines: string[] = [];
  ctx.print = (l: string) => lines.push(l);
  assert.equal(await engine.advance(ctx), 'needs_synthesis');
  assert.ok(lines.some((l) => /^▶ Codebase scan \(Claude ∥ Codex\)  \[step 1 · \d+s elapsed\]$/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('⏱ scan ')), 'heartbeat while the scan runs');
});

test('milestones watcher replays recent runner output, follows it, and exits with the status once the runner stops', async () => {
  const repo = gitRepo();
  const ctx = makeRun(repo, { claude: new FakeAgent('claude'), codex: new FakeAgent('codex') });
  const log = watchMod.runnerLog(ctx.dir);
  mkdirSync(join(ctx.dir, 'live'), { recursive: true });
  writeFileSync(log, 'old 1\nold 2\n▶ Codebase scan\n');
  writeFileSync(join(ctx.dir, 'run.lock'), String(process.pid)); // a live runner
  const out: string[] = [];
  const orig = console.log;
  console.log = (l: string) => out.push(l);
  try {
    const done = watchMod.followMilestones(ctx.dir, 20);
    await new Promise((r) => setTimeout(r, 60));
    appendFileSync(log, '⏱ scan 1m00s\n');
    await new Promise((r) => setTimeout(r, 60));
    appendFileSync(log, '⏸ Decompose — waiting\n');
    rmSync(join(ctx.dir, 'run.lock')); // runner exits
    await done;
  } finally {
    console.log = orig;
  }
  assert.deepEqual(out, ['old 1', 'old 2', '▶ Codebase scan', '⏱ scan 1m00s', '⏸ Decompose — waiting', '■ idle']);
});
