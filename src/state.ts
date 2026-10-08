import { readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { appendLine, exists, readJson, readText, slugify, writeJson, writeText } from './util.ts';
import type { Depth } from './config.ts';

/** 'interrupted' is never stored: it is what a stored 'running' reads as once the runner process is gone. */
export type RunStatus = 'running' | 'interrupted' | 'idle' | 'paused' | 'needs_synthesis' | 'needs_answers' | 'done' | 'failed';

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

export const duettoDir = (repo: string) => join(repo, '.duetto');

/**
 * One-time move from the pre-rename `.duet/` folder. Runs keep working: their worktree paths are absolute.
 * Returns true when it migrated.
 */
export function migrateLegacy(repo: string): boolean {
  const legacy = join(repo, '.duet');
  if (!exists(legacy) || exists(duettoDir(repo))) return false;
  renameSync(legacy, duettoDir(repo));
  const gi = join(repo, '.gitignore');
  if (exists(gi)) writeText(gi, readText(gi).replace(/^# duet$/m, '# duetto').replace(/^\.duet\//gm, '.duetto/'));
  return true;
}
export const runsDir = (repo: string) => join(duettoDir(repo), 'runs');
export const runDir = (repo: string, id: string) => join(runsDir(repo), id);

export function newRunId(request: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}-${slugify(request, 30)}`;
}

export function currentRunId(repo: string): string | null {
  const id = readText(join(duettoDir(repo), 'current')).trim();
  return id || null;
}

export function setCurrentRun(repo: string, id: string): void {
  writeText(join(duettoDir(repo), 'current'), id + '\n');
}

export function listRuns(repo: string): string[] {
  return exists(runsDir(repo)) ? readdirSync(runsDir(repo)).sort() : [];
}

export function loadState(dir: string): RunState {
  const state = readJson<RunState>(join(dir, 'state.json'));
  if (state.status === 'running' && !lockHolder(dir)) {
    state.status = 'interrupted';
    state.message = 'The process advancing this run is gone (killed, crashed or its session ended). `duetto run` resumes it; completed work is kept.';
  }
  return state;
}

export function saveState(dir: string, state: RunState): void {
  state.updated_at = new Date().toISOString();
  writeJson(join(dir, 'state.json'), state);
}

export function logEvent(dir: string, event: Record<string, unknown>): void {
  appendLine(join(dir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }));
}

/** Pid of the live process holding the run lock, or null. */
export function lockHolder(dir: string): number | null {
  const p = join(dir, 'run.lock');
  if (!exists(p)) return null;
  const pid = Number(readText(p).trim());
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** Single-writer lock per run so two `duetto run`s never advance the same run concurrently. */
export function acquireLock(dir: string): () => void {
  const p = join(dir, 'run.lock');
  const pid = lockHolder(dir);
  if (pid && pid !== process.pid) throw new Error(`Run is already being advanced by pid ${pid} (lock: ${p})`);
  writeText(p, String(process.pid));
  return () => rmSync(p, { force: true });
}
