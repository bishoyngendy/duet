import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { appendLine, exists, readJson, readText, slugify, writeJson, writeText } from './util.ts';
import type { Depth } from './config.ts';

export type RunStatus = 'running' | 'idle' | 'needs_synthesis' | 'needs_answers' | 'done' | 'failed';

export type RunState = {
  id: string;
  request: string;
  depth: Depth;
  status: RunStatus;
  step: { id: string; title: string; kind: string } | null;
  message: string | null;
  base_commit: string;
  base_branch: string;
  created_at: string;
  updated_at: string;
};

export const duetDir = (repo: string) => join(repo, '.duet');
export const runsDir = (repo: string) => join(duetDir(repo), 'runs');
export const runDir = (repo: string, id: string) => join(runsDir(repo), id);

export function newRunId(request: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}-${slugify(request, 30)}`;
}

export function currentRunId(repo: string): string | null {
  const id = readText(join(duetDir(repo), 'current')).trim();
  return id || null;
}

export function setCurrentRun(repo: string, id: string): void {
  writeText(join(duetDir(repo), 'current'), id + '\n');
}

export function listRuns(repo: string): string[] {
  return exists(runsDir(repo)) ? readdirSync(runsDir(repo)).sort() : [];
}

export function loadState(dir: string): RunState {
  return readJson<RunState>(join(dir, 'state.json'));
}

export function saveState(dir: string, state: RunState): void {
  state.updated_at = new Date().toISOString();
  writeJson(join(dir, 'state.json'), state);
}

export function logEvent(dir: string, event: Record<string, unknown>): void {
  appendLine(join(dir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }));
}

/** Single-writer lock per run so two `duet run`s never advance the same run concurrently. */
export function acquireLock(dir: string): () => void {
  const p = join(dir, 'run.lock');
  if (exists(p)) {
    const pid = Number(readText(p).trim());
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {}
    if (alive && pid !== process.pid) throw new Error(`Run is already being advanced by pid ${pid} (lock: ${p})`);
  }
  writeText(p, String(process.pid));
  return () => rmSync(p, { force: true });
}
