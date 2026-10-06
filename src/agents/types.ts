import type { Schema } from '../schema.ts';
import type { AgentName } from '../schemas.ts';

export type Role =
  | 'scanner'
  | 'researcher'
  | 'rebutter'
  | 'questioner'
  | 'planner'
  | 'challenger'
  | 'implementer'
  | 'reviewer'
  | 'converger'
  | 'synthesizer'
  | 'tester';

export type AgentCall = {
  role: Role;
  prompt: string;
  cwd: string;
  /** Read-only roles get no edit tools / a read-only sandbox. */
  writable: boolean;
  schema: Schema;
  /** Directory for this call's raw artifacts (prompt, argv, stdout, schema). */
  rawDir: string;
  label: string;
  timeoutMs: number;
};

export type AgentOutput = { text: string; structured?: unknown; costUsd?: number; raw: string };

export interface Agent {
  name: AgentName;
  /** One invocation. Throws on process failure; schema validation + retry happen in runAgent(). */
  invoke(call: AgentCall): Promise<AgentOutput>;
}
