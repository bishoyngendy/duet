import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const exists = (p: string) => existsSync(p);

export function readJson<T = any>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

export function readText(p: string, fallback = ''): string {
  return existsSync(p) ? readFileSync(p, 'utf8') : fallback;
}

/** Atomic write: write to a temp file then rename, so a crash never leaves half a file. */
export function writeText(p: string, content: string): void {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, p);
}

export function writeJson(p: string, data: unknown): void {
  writeText(p, JSON.stringify(data, null, 2) + '\n');
}

export function appendLine(p: string, line: string): void {
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, line + '\n');
}

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function slugify(s: string, max = 40): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .slice(0, max)
      .replace(/-+$/, '') || 'run'
  );
}

export function tail(s: string, n = 4000): string {
  return s.length <= n ? s : `…(truncated ${s.length - n} chars)…\n` + s.slice(-n);
}

export function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

export type ExecResult = { code: number; stdout: string; stderr: string; timedOut: boolean; durationMs: number };

/** Process groups of children still running, so they can be torn down if the engine itself is stopped. */
const liveGroups = new Set<number>();

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {}
}

let signalsHooked = false;
function hookSignals(): void {
  if (signalsHooked) return;
  signalsHooked = true;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(sig, () => {
      for (const pid of liveGroups) killGroup(pid, 'SIGKILL');
      process.kill(process.pid, sig);
    });
  }
}

/** After the child exits, how long to wait for grandchildren that inherited its stdio to let go of the pipes. */
const DRAIN_MS = 2000;

export function exec(
  cmd: string,
  args: string[],
  opts: { cwd: string; input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = { cwd: process.cwd() },
): Promise<ExecResult> {
  const started = Date.now();
  hookSignals();
  return new Promise((resolve, reject) => {
    const piped = opts.input !== undefined;
    // Own process group: a timeout kills the whole tree (test runners, build daemons), not just the CLI.
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: [piped ? 'pipe' : 'ignore', 'pipe', 'pipe'], detached: true });
    const pid = child.pid;
    if (pid) liveGroups.add(pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pid) liveGroups.delete(pid);
      resolve({ code: code ?? -1, stdout, stderr, timedOut, durationMs: Date.now() - started });
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          if (pid) killGroup(pid, 'SIGTERM');
          setTimeout(() => pid && killGroup(pid, 'SIGKILL'), 5000).unref();
        }, opts.timeoutMs)
      : undefined;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      if (pid) liveGroups.delete(pid);
      settled = true;
      reject(err);
    });
    child.on('close', (code) => finish(code));
    // 'close' waits for every holder of the stdio pipes; a leftover grandchild would make it wait forever.
    child.on('exit', (code) => {
      setTimeout(() => {
        if (settled) return;
        child.stdout.destroy();
        child.stderr.destroy();
        if (pid) killGroup(pid, 'SIGKILL');
        finish(code);
      }, DRAIN_MS).unref();
    });
    if (child.stdin) {
      // A child may exit without reading its input (e.g. a fast failure); that EPIPE is not our error.
      child.stdin.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EPIPE') reject(err);
      });
      child.stdin.end(opts.input);
    }
  });
}

export function sh(command: string, cwd: string, timeoutMs?: number): Promise<ExecResult> {
  return exec('/bin/sh', ['-c', command], { cwd, timeoutMs });
}

export function topoSort<T extends { id: string; depends_on: string[] }>(items: T[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: T[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (item: T, trail: string[]) => {
    const s = state.get(item.id);
    if (s === 'done') return;
    if (s === 'visiting') throw new Error(`Dependency cycle: ${[...trail, item.id].join(' → ')}`);
    state.set(item.id, 'visiting');
    for (const dep of item.depends_on) {
      const d = byId.get(dep);
      if (!d) throw new Error(`${item.id} depends on unknown id "${dep}"`);
      visit(d, [...trail, item.id]);
    }
    state.set(item.id, 'done');
    out.push(item);
  };
  for (const i of items) visit(i, []);
  return out;
}
