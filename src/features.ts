// Which feature a per-phase command (`duetto plan`, …) acts on. Features are indexed in .duetto/features.json as
// they are created, and resolved in Spec Kit's order: explicit flag, SPECIFY_* env, .specify/feature.json, branch.

import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readFeatureDir } from './speckit.ts';
import { currentRunId, duettoDir } from './state.ts';
import { exists, readJson, writeJson } from './util.ts';

export type FeatureEntry = { run: string; feature: string; spec_dir: string; branch: string; worktree: string };

const indexPath = (repo: string) => join(duettoDir(repo), 'features.json');

export function listFeatures(repo: string): FeatureEntry[] {
  return exists(indexPath(repo)) ? readJson<{ features: FeatureEntry[] }>(indexPath(repo)).features : [];
}

export function registerFeature(repo: string, entry: FeatureEntry): void {
  const all = listFeatures(repo).filter((e) => !(e.run === entry.run && e.feature === entry.feature));
  writeJson(indexPath(repo), { features: [...all, entry] });
}

/** Highest feature number reserved by any run, so concurrent runs from the same base don't both take 001. */
export function highestReserved(repo: string): number {
  return Math.max(0, ...listFeatures(repo).map((e) => Number(basename(e.spec_dir).match(/^(\d+)-/)?.[1] ?? 0)));
}

/** Does `token` (001, 001-slug, slug, specs/001-slug, a branch name, or F1 of the current run) name this entry? */
function matches(e: FeatureEntry, token: string, currentRun: string | null): boolean {
  const dir = basename(e.spec_dir);
  const t = token.replace(/\/+$/, '');
  return (
    dir === basename(t) ||
    e.spec_dir === t ||
    t.endsWith(`/${e.spec_dir}`) ||
    dir.startsWith(`${t}-`) ||
    dir.replace(/^\d+-/, '') === t ||
    e.branch === t ||
    (e.feature === t && e.run === currentRun)
  );
}

/**
 * A spec dir written by Spec Kit itself (/speckit-specify) that no duetto run owns yet: `token` is a path, a dir
 * name, its number or its slug. Returns the repo-relative dir.
 */
export function findAdoptable(repo: string, token: string): string | null {
  const specs = join(repo, 'specs');
  const t = token.replace(/\/+$/, '');
  const name = basename(t);
  const dirs = exists(specs) ? readdirSync(specs).filter((d) => exists(join(specs, d, 'spec.md'))) : [];
  const dir = dirs.find((d) => d === name || d.startsWith(`${name}-`) || d.replace(/^\d+-/, '') === name);
  if (!dir || listFeatures(repo).some((e) => basename(e.spec_dir) === dir)) return null;
  return `specs/${dir}`;
}

export type Resolved = FeatureEntry | { adopt: string };

export function resolveFeature(repo: string, o: { flag?: string; env?: NodeJS.ProcessEnv; branch?: string } = {}): Resolved {
  const env = o.env ?? process.env;
  const all = listFeatures(repo);
  const current = currentRunId(repo);
  const candidates = [o.flag, env.SPECIFY_FEATURE_DIRECTORY, env.SPECIFY_FEATURE, readFeatureDir(repo) ?? undefined, o.branch].filter((x): x is string => Boolean(x));
  for (const token of candidates) {
    const hit = [...all].reverse().find((e) => matches(e, token, current));
    if (hit) return hit;
    const adopt = findAdoptable(repo, token);
    if (adopt) return { adopt };
    if (token === o.flag) throw new Error(`No duetto feature or Spec Kit spec matches "${token}". Known: ${all.map((e) => basename(e.spec_dir)).join(', ') || 'none'}`);
  }
  const fromRun = all.filter((e) => e.run === current);
  const unfinished = fromRun.find((e) => !exists(join(duettoDir(repo), 'runs', e.run, 'features', e.feature, 'report.json')));
  const pick = unfinished ?? fromRun.at(-1);
  if (pick) return pick;
  throw new Error('No duetto feature found. Start one with: duetto specify "<description>"');
}
