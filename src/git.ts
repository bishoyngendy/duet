import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { exec, sha } from './util.ts';

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await exec('git', args, { cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${res.stderr.trim() || res.stdout.trim()}`);
  return res.stdout.trimEnd();
}

export async function repoRoot(cwd: string): Promise<string> {
  return git(cwd, 'rev-parse', '--show-toplevel');
}

export const head = (cwd: string) => git(cwd, 'rev-parse', 'HEAD');

export async function currentBranch(cwd: string): Promise<string> {
  return git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
}

export function worktreePath(repo: string, worktreesDir: string | null, runId: string, featureId: string): string {
  const root = worktreesDir ?? join(homedir(), '.duetto', 'worktrees');
  return join(root, `${basename(repo)}-${sha(repo).slice(0, 8)}`, runId, featureId);
}

export async function addWorktree(repo: string, path: string, branch: string, base: string): Promise<void> {
  await git(repo, 'worktree', 'add', '-b', branch, path, base);
}

/** Best effort: a leftover task worktree or branch is harmless, so cleanup failures are ignored. */
export async function removeWorktree(repo: string, path: string, branch: string): Promise<void> {
  await git(repo, 'worktree', 'remove', '--force', path).catch(() => {});
  await git(repo, 'branch', '-D', branch).catch(() => {});
}

/** Stage everything (respecting .gitignore) so diffs include new files uniformly. */
async function stageAll(wt: string): Promise<void> {
  await git(wt, 'add', '-A');
}

/** Tree hash of the full working state — used to prove a read-only agent changed nothing. */
export async function snapshot(wt: string): Promise<string> {
  await stageAll(wt);
  return git(wt, 'write-tree');
}

/** Restore the worktree to a previous snapshot (drops anything added since). */
export async function restore(wt: string, tree: string): Promise<void> {
  await stageAll(wt);
  await git(wt, 'read-tree', '--reset', '-u', tree);
}

export async function changedFiles(wt: string, base: string): Promise<string[]> {
  await stageAll(wt);
  const out = await git(wt, 'diff', '--cached', '--name-only', base);
  return out ? out.split('\n') : [];
}

/** Inline diffs are capped: past this the reader is told how to page through the rest with git. */
export async function diff(wt: string, base: string, maxChars = 60_000): Promise<{ stat: string; patch: string }> {
  await stageAll(wt);
  const stat = await git(wt, 'diff', '--cached', '--stat', base);
  let patch = await git(wt, 'diff', '--cached', base);
  if (patch.length > maxChars) {
    patch = patch.slice(0, maxChars) + `\n…(diff truncated, ${patch.length - maxChars} more chars — run \`git diff ${base} -- <path>\` for the files you need; see diff_stat)`;
  }
  return { stat, patch };
}

export async function commitAll(wt: string, message: string): Promise<string | null> {
  await stageAll(wt);
  const status = await git(wt, 'status', '--porcelain');
  if (!status) return null;
  // --no-verify: duetto runs the project's checks itself before committing.
  await git(wt, 'commit', '-q', '--no-verify', '-m', message);
  return head(wt);
}
