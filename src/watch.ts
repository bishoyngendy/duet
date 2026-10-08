// `duetto watch`: live views of what Claude and Codex are doing, from the files src/live.ts writes.
//   --agent claude|codex   follow one agent's transcript (what the auto-opened panes run)
//   (no flag, in a TTY)    both agents stacked in one screen, redrawn twice a second
//   --compact              both agents merged, one line per activity (pipes, Monitor)

import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { liveDir, liveLog, readLiveStatus } from './live.ts';
import type { AgentName } from './schemas.ts';
import { loadState, lockHolder } from './state.ts';
import { exists, fmtMs } from './util.ts';

const AGENTS: AgentName[] = ['claude', 'codex'];
const POLL_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const C = { dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m', claude: '\x1b[38;5;209m', codex: '\x1b[38;5;75m' };

/** Reads whatever was appended to a file since the last call. */
export function tailer(path: string) {
  let offset = 0;
  return (): string => {
    if (!exists(path)) return '';
    const size = statSync(path).size;
    if (size < offset) offset = 0;
    if (size === offset) return '';
    const buf = Buffer.alloc(size - offset);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, buf, 0, buf.length, offset);
    } finally {
      closeSync(fd);
    }
    offset = size;
    return buf.toString('utf8');
  };
}

/** One-line "what is this agent doing" summary from its live status. */
export function agentHeadline(dir: string, agent: AgentName, now = Date.now()): string {
  const calls = Object.values(readLiveStatus(dir, agent).calls);
  if (!calls.length) return `${agent} · idle`;
  return calls
    .map((c) => `${agent} · ${c.role} ${c.step} · ${fmtMs(now - Date.parse(c.started_at))} · ${c.events} events`)
    .join('  |  ');
}

const finished = (dir: string) => {
  try {
    return loadState(dir).status === 'done';
  } catch {
    return false;
  }
};

async function followOne(dir: string, agent: AgentName): Promise<number> {
  process.stdout.write(`\x1b]2;duetto · ${agent}\x07${C[agent]}${C.bold}duetto · ${agent}${C.reset} ${C.dim}(live; Ctrl-C to close)${C.reset}\n`);
  const next = tailer(liveLog(dir, agent));
  const backlog = next().split('\n');
  process.stdout.write(backlog.slice(-60).join('\n'));
  for (;;) {
    process.stdout.write(next());
    if (finished(dir)) break;
    await sleep(POLL_MS);
  }
  process.stdout.write(`\n${C.bold}✔ run complete${C.reset}\n`);
  if (process.stdin.isTTY) {
    process.stdout.write(`${C.dim}press any key to close${C.reset}\n`);
    process.stdin.setRawMode(true);
    await new Promise((r) => process.stdin.once('data', r));
  }
  return 0;
}

async function followCompact(dir: string): Promise<number> {
  const next = Object.fromEntries(AGENTS.map((a) => [a, tailer(liveLog(dir, a))]));
  for (const a of AGENTS) next[a](); // skip history: compact mode reports what happens from now on
  for (;;) {
    for (const a of AGENTS) {
      for (const line of next[a]().split('\n')) if (line.trim()) console.log(`${a.padEnd(6)}│ ${line}`);
    }
    if (finished(dir)) return 0;
    await sleep(POLL_MS);
  }
}

/** Last lines of a file without reading all of it. */
function lastLines(path: string, n: number): string[] {
  if (!exists(path)) return [];
  const size = statSync(path).size;
  const len = Math.min(size, 64 * 1024);
  const buf = Buffer.alloc(len);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, 0, len, size - len);
  } finally {
    closeSync(fd);
  }
  return buf.toString('utf8').split('\n').filter((l) => l.trim()).slice(-n);
}

async function splitView(dir: string): Promise<number> {
  const out = process.stdout;
  const restore = () => out.write('\x1b[?25h\x1b[?1049l');
  out.write('\x1b[?1049h\x1b[?25l');
  process.once('SIGINT', () => {
    restore();
    process.exit(0);
  });
  try {
    while (!finished(dir)) {
      const rows = out.rows ?? 40;
      const cols = out.columns ?? 100;
      const half = Math.max(3, Math.floor((rows - 1) / 2));
      const frame = AGENTS.flatMap((a) => {
        const body = lastLines(liveLog(dir, a), half - 1).map((l) => l.slice(0, cols));
        const pad = Array(half - 1 - body.length).fill('');
        return [`${C[a]}${C.bold}${agentHeadline(dir, a).slice(0, cols)}${C.reset}`, ...pad, ...body];
      });
      out.write('\x1b[H\x1b[2J' + frame.join('\n'));
      await sleep(POLL_MS);
    }
  } finally {
    restore();
  }
  console.log('✔ run complete');
  return 0;
}

export const runnerLog = (dir: string) => join(liveDir(dir), 'runner.log');

/**
 * Follows a detached runner's output (steps, heartbeats, pauses) and exits once the runner stops, ending with
 * the run's status — so a watcher (e.g. Claude Code's Monitor) finishes exactly when the orchestrator is needed.
 */
export async function followMilestones(dir: string, pollMs = POLL_MS): Promise<number> {
  const next = tailer(runnerLog(dir));
  const backlog = next().split('\n').filter((l) => l.trim());
  for (const l of backlog.slice(-5)) console.log(l);
  for (;;) {
    const alive = lockHolder(dir) !== null;
    for (const l of next().split('\n')) if (l.trim()) console.log(l);
    if (!alive) break;
    await sleep(pollMs);
  }
  const s = loadState(dir);
  console.log(`■ ${s.status}${s.step ? ` — ${s.step.title}` : ''}${s.message ? ` — ${s.message}` : ''}`);
  return 0;
}

export function watch(dir: string, opts: { agent?: string; compact?: boolean; milestones?: boolean }): Promise<number> {
  if (opts.milestones) return followMilestones(dir);
  if (opts.agent) {
    if (!AGENTS.includes(opts.agent as AgentName)) throw new Error('--agent must be claude or codex');
    return followOne(dir, opts.agent as AgentName);
  }
  return opts.compact || !process.stdout.isTTY ? followCompact(dir) : splitView(dir);
}
