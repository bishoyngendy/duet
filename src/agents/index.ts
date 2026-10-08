import { join } from 'node:path';
import { parseJsonLoose, validate } from '../schema.ts';
import { writeText } from '../util.ts';
import type { Config } from '../config.ts';
import type { AgentName } from '../schemas.ts';
import { ClaudeAgent } from './claude.ts';
import { CodexAgent } from './codex.ts';
import type { Agent, AgentCall } from './types.ts';

export type Agents = Record<AgentName, Agent>;

export function createAgents(config: Config): Agents {
  return { claude: new ClaudeAgent(config.agents.claude), codex: new CodexAgent(config.agents.codex) };
}

export const other = (a: AgentName): AgentName => (a === 'claude' ? 'codex' : 'claude');

export type AgentRun = { output: any; durationMs: number; costUsd?: number; attempts: number };

/** Invoke an agent, validate against the schema, and retry once with the validation errors appended. */
export async function runAgent(agent: Agent, call: AgentCall): Promise<AgentRun> {
  const started = Date.now();
  let prompt = call.prompt;
  let lastErrors: string[] = [];
  let cost = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const label = attempt === 1 ? call.label : `${call.label}.retry`;
    writeText(join(call.rawDir, `${label}.prompt.md`), prompt);
    const out = await agent.invoke({ ...call, prompt, label });
    cost += out.costUsd ?? 0;
    let value: unknown;
    try {
      value = out.structured ?? parseJsonLoose(out.text);
      lastErrors = validate(call.schema, value);
    } catch (err) {
      lastErrors = [(err as Error).message];
    }
    if (lastErrors.length === 0) {
      return { output: value, durationMs: Date.now() - started, costUsd: cost || undefined, attempts: attempt };
    }
    call.onActivity?.({ kind: 'retry', text: `output did not match the schema (${lastErrors.length} errors) — asking again` });
    prompt =
      call.prompt +
      `\n\n---\nYour previous response did not match the required JSON schema:\n${lastErrors.slice(0, 30).join('\n')}\n` +
      `Respond again with a single JSON object that matches the schema exactly.`;
  }
  throw new Error(`${agent.name} output failed schema validation twice:\n${lastErrors.slice(0, 15).join('\n')}`);
}
