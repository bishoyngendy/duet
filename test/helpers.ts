import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, AgentCall, AgentOutput } from '../src/agents/types.ts';
import { loadConfig } from '../src/config.ts';
import { advance, answer, locate, submit } from '../src/engine.ts';
import type { Ctx, Step } from '../src/pipeline.ts';
import type { Schema } from '../src/schema.ts';
import type { AgentName } from '../src/schemas.ts';
import { loadState, logEvent, newRunId, runDir, saveState, setCurrentRun } from '../src/state.ts';
import { readJson, writeJson, writeText } from '../src/util.ts';

/** Minimal valid instance of a strict schema: nulls for nullables, first enum value, empty arrays. */
export function fakeFromSchema(schema: Schema): any {
  if (schema.anyOf) return null;
  const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('null')) return null;
  if (schema.enum) return schema.enum[0];
  switch (types[0]) {
    case 'string':
      return 'x';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return Object.fromEntries(Object.entries(schema.properties).map(([k, s]) => [k, fakeFromSchema(s as Schema)]));
  }
  throw new Error(`cannot fake ${JSON.stringify(schema)}`);
}

export type Behaviour = (call: AgentCall, base: any) => any;

export class FakeAgent implements Agent {
  name: AgentName;
  calls: AgentCall[] = [];
  behaviour: Behaviour;
  constructor(name: AgentName, behaviour: Behaviour = (_c, b) => b) {
    this.name = name;
    this.behaviour = behaviour;
  }
  async invoke(call: AgentCall): Promise<AgentOutput> {
    this.calls.push(call);
    const out = this.behaviour(call, fakeFromSchema(call.schema));
    return { text: JSON.stringify(out), raw: '' };
  }
}

export function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orch-e2e-'));
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(join(dir, '.gitignore'), '.orchestra/runs/\n.orchestra/current\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'init');
  return dir;
}

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

export function makeRun(repo: string, agents: Record<AgentName, Agent>, opts: { depth?: 'quick' | 'standard' | 'deep'; config?: any } = {}): Ctx {
  const config = { ...loadConfig(repo), ...(opts.config ?? {}) };
  config.checks = { setup: null, commands: ['true'], timeout_minutes: 1, ...(opts.config?.checks ?? {}) };
  config.worktrees_dir = mkdtempSync(join(tmpdir(), 'orch-wt-'));
  const id = newRunId('test idea');
  const dir = runDir(repo, id);
  const now = new Date().toISOString();
  writeText(join(dir, 'request.md'), 'test idea\n');
  saveState(dir, {
    id,
    request: 'test idea',
    depth: opts.depth ?? 'standard',
    status: 'idle',
    step: null,
    message: null,
    base_commit: git(repo, 'rev-parse', 'HEAD'),
    base_branch: 'main',
    created_at: now,
    updated_at: now,
  });
  setCurrentRun(repo, id);
  logEvent(dir, { type: 'start' });
  return { repo, dir, config, state: loadState(dir), agents, print: () => {} };
}

export type HostScript = (step: Step, base: any) => any;
export type GateScript = (step: Step) => Record<string, string> | 'suggested';

/** Drive a run to completion, answering host steps and gates with the given scripts. */
export async function drive(ctx: Ctx, hostScript: HostScript, gateScript: GateScript, maxIterations = 200): Promise<string[]> {
  const visited: string[] = [];
  for (let i = 0; i < maxIterations; i++) {
    const status = await advance(ctx);
    if (status === 'done') return visited;
    if (status === 'failed') throw new Error(`run failed: ${ctx.state.message}`);
    const { step } = locate(ctx);
    if (!step) throw new Error('no step but not done');
    visited.push(step.id);
    if (step.kind === 'host') {
      const data = hostScript(step, fakeFromSchema((await import('../src/schemas.ts')).SCHEMAS[step.host!.schema]));
      const file = join(ctx.dir, 'host', 'draft.json');
      writeJson(file, data);
      await submit(ctx, file);
    } else if (step.kind === 'user') {
      const a = gateScript(step);
      await answer(ctx, a === 'suggested' ? {} : a, a === 'suggested');
    }
  }
  throw new Error('drive: too many iterations');
}

export { readJson };
