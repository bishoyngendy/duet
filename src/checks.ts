import { matchesGlob } from 'node:path';
import { sh, tail } from './util.ts';
import { changedFiles, diff } from './git.ts';
import type { Config } from './config.ts';
import type { Task } from './schemas.ts';

export type CheckResult = {
  passed: boolean;
  commands: { cmd: string; exit_code: number; timed_out: boolean; duration_ms: number; output_tail: string }[];
  changed_files: string[];
  scope_violations: string[];
  protected_violations: string[];
  diff_stat: string;
};

const matchesAny = (file: string, patterns: string[]) =>
  patterns.some((p) => matchesGlob(file, p) || file === p || file.startsWith(p.replace(/\/?\*\*$/, '') + '/'));

/**
 * Deterministic verification after each implementation round: the project's checks, the task's own
 * test command, scope (files outside files_in_scope are reported to the reviewer, not failed), and
 * protected paths (hard fail).
 */
export async function runChecks(config: Config, wt: string, base: string, task: Task | null): Promise<CheckResult> {
  const cmds = [...config.checks.commands];
  if (task?.test_command && !cmds.includes(task.test_command)) cmds.push(task.test_command);
  const commands: CheckResult['commands'] = [];
  for (const cmd of cmds) {
    const res = await sh(cmd, wt, config.checks.timeout_minutes * 60_000);
    commands.push({
      cmd,
      exit_code: res.code,
      timed_out: res.timedOut,
      duration_ms: res.durationMs,
      output_tail: tail(`${res.stdout}\n${res.stderr}`.trim(), 6000),
    });
  }
  const files = await changedFiles(wt, base);
  const inScope = task ? [...task.files_in_scope, 'specs/**'] : ['**'];
  const scope_violations = task && task.files_in_scope.length ? files.filter((f) => !matchesAny(f, inScope)) : [];
  const protected_violations = files.filter((f) => matchesAny(f, config.protected_paths));
  const { stat } = await diff(wt, base, 0);
  return {
    passed: commands.every((c) => c.exit_code === 0) && protected_violations.length === 0,
    commands,
    changed_files: files,
    scope_violations,
    protected_violations,
    diff_stat: stat,
  };
}
