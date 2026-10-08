// Opens a live pane per worker (`duetto watch --agent …`) next to the orchestrator, in cmux or tmux.

import { join } from 'node:path';
import { liveDir } from './live.ts';
import { exec, exists, writeJson } from './util.ts';

export type PanesMode = 'auto' | 'cmux' | 'tmux' | 'off';
export type Runner = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const defaultRunner: Runner = (cmd, args) => exec(cmd, args, { cwd: process.cwd(), timeoutMs: 10_000 });
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function detectMux(env: NodeJS.ProcessEnv): 'cmux' | 'tmux' | null {
  if (env.CMUX_SURFACE_ID && (env.CMUX_BUNDLED_CLI_PATH || env.CMUX_SOCKET_PATH)) return 'cmux';
  if (env.TMUX) return 'tmux';
  return null;
}

/**
 * The command a pane runs to follow one agent of this run. cmux types it into an interactive shell: `clear` hides
 * the long command line and `exec` makes the pane close when the watcher exits at the end of the run.
 */
export function watchCommand(repo: string, runId: string, agent: string, bin = process.argv[1], node = process.execPath): string {
  return `clear; cd ${shq(repo)} && exec ${shq(node)} ${shq(bin)} watch --agent ${agent} --run ${shq(runId)}`;
}

/**
 * Opens a Claude pane to the right of the orchestrator and a Codex pane below it, once per run
 * (live/panes.json records it, so resuming doesn't stack more splits). Returns a line for the user.
 */
export async function openPanes(
  o: { dir: string; repo: string; runId: string; mode: PanesMode },
  env: NodeJS.ProcessEnv = process.env,
  run: Runner = defaultRunner,
  command = (agent: string) => watchCommand(o.repo, o.runId, agent),
): Promise<string> {
  const record = join(liveDir(o.dir), 'panes.json');
  const fallback = 'Watch Claude and Codex live: duetto watch';
  if (o.mode === 'off') return fallback;
  if (exists(record)) return 'Live Claude/Codex panes were opened for this run (reopen: duetto panes)';
  const mux = o.mode === 'auto' ? detectMux(env) : o.mode;
  if (!mux) return fallback;
  try {
    const ids: string[] = [];
    if (mux === 'cmux') {
      const bin = env.CMUX_BUNDLED_CLI_PATH ?? 'cmux';
      const first = await run(bin, ['new-split', 'right', '--focus', 'false', '--command', command('claude')]);
      const surface = first.stdout.match(/surface:\d+/)?.[0];
      if (first.code !== 0 || !surface) throw new Error(first.stderr || first.stdout);
      ids.push(surface);
      const second = await run(bin, ['new-split', 'down', '--surface', surface, '--focus', 'false', '--command', command('codex')]);
      ids.push(second.stdout.match(/surface:\d+/)?.[0] ?? '?');
    } else {
      const first = await run('tmux', ['split-window', '-h', '-d', '-P', '-F', '#{pane_id}', command('claude')]);
      const pane = first.stdout.trim();
      if (first.code !== 0 || !pane) throw new Error(first.stderr || first.stdout);
      ids.push(pane);
      const second = await run('tmux', ['split-window', '-v', '-d', '-P', '-F', '#{pane_id}', '-t', pane, command('codex')]);
      ids.push(second.stdout.trim());
    }
    writeJson(record, { mux, panes: ids, opened_at: new Date().toISOString() });
    return `Opened live Claude and Codex panes (${mux})`;
  } catch (err) {
    return `${fallback}  (could not open ${mux} panes: ${(err as Error).message.trim().slice(0, 120)})`;
  }
}
