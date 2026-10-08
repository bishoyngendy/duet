import { join } from 'node:path';
import { exists, readJson } from './util.ts';
import type { PanesMode } from './panes.ts';
import type { AgentName } from './schemas.ts';

export type Depth = 'quick' | 'standard' | 'deep';

export type RoleOverride = { model?: string; effort?: string };
export type AgentConfig = {
  model: string;
  effort: string;
  /** Per-role overrides, e.g. a cheaper effort for the scan. Keys are worker roles. */
  roles?: Record<string, RoleOverride>;
  command?: string;
};

export function resolveAgent(cfg: AgentConfig, role: string): { model: string; effort: string } {
  const r = cfg.roles?.[role] ?? {};
  return { model: r.model ?? cfg.model, effort: r.effort ?? cfg.effort };
}

export type Config = {
  agents: Record<AgentName, AgentConfig>;
  depth: Depth;
  /** Agent that performs host steps (synthesis) when `duetto run --headless` is used. */
  synthesizer_fallback: AgentName;
  first_implementer: AgentName;
  /** Max tasks implemented at once, each in its own worktree (independent tasks with disjoint files_in_scope). 1 = serial. */
  parallel_tasks: number;
  max_review_rounds: number;
  review: {
    /** Severities that make a review "changes_required" even if the reviewer approved. */
    blocking: string[];
    /** Severities the implementer is asked to address (or dispute) in a polish round after approval. */
    polish: string[];
    /** Extra rounds allowed per task for polish findings. 0 disables polishing. */
    polish_rounds: number;
  };
  max_clarify_rounds: Record<Depth, number>;
  timeout_minutes: number;
  /** Conflict categories the host may never resolve on its own — they always go to the user. */
  escalate_categories: string[];
  checks: { setup: string | null; commands: string[]; timeout_minutes: number };
  protected_paths: string[];
  worktrees_dir: string | null;
  /**
   * Where a feature is built. 'worktree' (default): its own git worktree and branch, your checkout untouched.
   * 'inplace' (single-feature `duetto specify` runs): a Spec Kit-style NNN-slug branch in your checkout, which must
   * be clean and which duetto commits to. Parallel tasks still use their own worktrees.
   */
  workspace: 'worktree' | 'inplace';
  /**
   * panes: open live Claude/Codex panes next to the orchestrator ('auto' = in cmux or tmux when detected).
   * heartbeat_seconds: progress line while a step runs (0 = off). stall_minutes: warn when a worker goes quiet.
   */
  ui: { panes: PanesMode; heartbeat_seconds: number; stall_minutes: number };
};

export const DEFAULT_CONFIG: Config = {
  agents: {
    claude: { model: 'claude-opus-5-5', effort: 'high', roles: { scanner: { effort: 'medium' }, questioner: { effort: 'medium' } } },
    // Codex is the slower model on every parallel step; analysis roles run at medium so it stops gating them.
    codex: {
      model: 'gpt-6.1-sol',
      effort: 'high',
      roles: Object.fromEntries(['scanner', 'questioner', 'researcher', 'rebutter', 'challenger', 'reviewer'].map((r) => [r, { effort: 'medium' }])),
    },
  },
  depth: 'standard',
  synthesizer_fallback: 'claude',
  first_implementer: 'claude',
  parallel_tasks: 3,
  max_review_rounds: 3,
  review: { blocking: ['critical', 'high', 'medium'], polish: ['low'], polish_rounds: 1 },
  max_clarify_rounds: { quick: 1, standard: 2, deep: 3 },
  timeout_minutes: 45,
  escalate_categories: ['requirements', 'architecture', 'security', 'constitution', 'other'],
  checks: { setup: null, commands: [], timeout_minutes: 20 },
  protected_paths: ['.env', '.env.*', '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/secrets/**', '.github/workflows/**'],
  worktrees_dir: null,
  workspace: 'worktree',
  ui: { panes: 'auto', heartbeat_seconds: 60, stall_minutes: 10 },
};

function merge<T>(base: T, over: any): T {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return (over ?? base) as T;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge((base as any)?.[k] ?? {}, v) : v;
  }
  return out;
}

export function loadConfig(repo: string): Config {
  const p = join(repo, '.duetto', 'config.json');
  return exists(p) ? merge(DEFAULT_CONFIG, readJson(p)) : DEFAULT_CONFIG;
}

/** Best-effort detection of install/test commands for `duetto init`. */
export function detectChecks(repo: string): Config['checks'] {
  const checks: Config['checks'] = { setup: null, commands: [], timeout_minutes: 20 };
  const pkgPath = join(repo, 'package.json');
  if (!exists(pkgPath)) return checks;
  const pkg = readJson(pkgPath);
  const pm = exists(join(repo, 'pnpm-lock.yaml'))
    ? 'pnpm'
    : exists(join(repo, 'yarn.lock'))
      ? 'yarn'
      : exists(join(repo, 'bun.lockb')) || exists(join(repo, 'bun.lock'))
        ? 'bun'
        : 'npm';
  const hasDeps = ['dependencies', 'devDependencies', 'optionalDependencies'].some((k) => Object.keys(pkg[k] ?? {}).length);
  if (hasDeps) checks.setup = { pnpm: 'pnpm install --frozen-lockfile', yarn: 'yarn install --frozen-lockfile', bun: 'bun install', npm: exists(join(repo, 'package-lock.json')) ? 'npm ci' : 'npm install' }[pm]!;
  const run = pm === 'npm' ? 'npm run' : pm;
  for (const script of ['typecheck', 'lint', 'test']) {
    if (pkg.scripts?.[script]) checks.commands.push(script === 'test' && pm === 'npm' ? 'npm test' : `${run} ${script}`);
  }
  return checks;
}
