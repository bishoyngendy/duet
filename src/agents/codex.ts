import { join } from 'node:path';
import { exec, exists, readText, tail, writeJson, writeText } from '../util.ts';
import { resolveAgent, type AgentConfig } from '../config.ts';
import type { Agent, AgentCall, AgentOutput } from './types.ts';
import { childEnv } from './claude.ts';

export class CodexAgent implements Agent {
  name = 'codex' as const;
  private cfg: AgentConfig;
  constructor(cfg: AgentConfig) {
    this.cfg = cfg;
  }

  async invoke(call: AgentCall): Promise<AgentOutput> {
    const { model, effort } = resolveAgent(this.cfg, call.role);
    const schemaPath = join(call.rawDir, `${call.label}.schema.json`);
    const outPath = join(call.rawDir, `${call.label}.last.json`);
    writeJson(schemaPath, call.schema);
    const args = [
      'exec',
      '-m',
      model,
      '-c',
      `model_reasoning_effort="${effort}"`,
      '-C',
      call.cwd,
      '-s',
      call.writable ? 'workspace-write' : 'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--output-schema',
      schemaPath,
      '-o',
      outPath,
      '--json',
      '-',
    ];
    const cmd = this.cfg.command ?? 'codex';
    writeText(join(call.rawDir, `${call.label}.argv.json`), JSON.stringify([cmd, ...args], null, 2));
    const res = await exec(cmd, args, { cwd: call.cwd, input: call.prompt, timeoutMs: call.timeoutMs, env: childEnv() });
    writeText(join(call.rawDir, `${call.label}.events.jsonl`), res.stdout);
    if (res.stderr) writeText(join(call.rawDir, `${call.label}.stderr.txt`), res.stderr);
    if (res.timedOut) throw new Error(`codex timed out after ${Math.round(call.timeoutMs / 60000)}m`);
    if (res.code !== 0 || !exists(outPath)) {
      throw new Error(`codex exited ${res.code}: ${tail(res.stderr || lastError(res.stdout), 800)}`);
    }
    return { text: readText(outPath), raw: res.stdout };
  }
}

function lastError(jsonl: string): string {
  const lines = jsonl.trim().split('\n').reverse();
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      const msg = e?.msg?.message ?? e?.message ?? e?.error?.message;
      if (msg) return String(msg);
    } catch {}
  }
  return tail(jsonl, 800);
}
