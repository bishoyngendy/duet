import type { Config } from './config.ts';
import type { MergedQ } from './schemas.ts';

type Conflict = {
  id: string;
  topic: string;
  category: string;
  claude_position: string;
  codex_position: string;
  resolution: string | null;
  status: 'consensus' | 'resolved' | 'needs_user';
  options: { key: string; label: string; description: string }[];
};

/**
 * Bias guard. The host model is one of the two debaters, so it may only settle minor conflicts.
 * Any conflict in an escalation category that the host marked "resolved" — or anything marked
 * needs_user — is turned into a question for the human. Returns the ids that were bounced.
 */
export function bounceConflicts(config: Config, data: { conflicts?: Conflict[]; questions: MergedQ[] }): string[] {
  const bounced: string[] = [];
  const existing = new Set(data.questions.map((q) => q.id));
  for (const c of data.conflicts ?? []) {
    const escalate = c.status === 'needs_user' || (c.status === 'resolved' && config.escalate_categories.includes(c.category));
    if (!escalate) continue;
    const qid = `D-${c.id}`;
    c.status = 'needs_user';
    bounced.push(c.id);
    if (existing.has(qid)) continue;
    const options = c.options.length
      ? c.options
      : [
          { key: 'claude', label: "Claude's approach", description: c.claude_position },
          { key: 'codex', label: "Codex's approach", description: c.codex_position },
        ];
    data.questions.push({
      id: qid,
      text: `${c.topic}${c.resolution ? ` (host proposed: ${c.resolution})` : ''}`,
      category: c.category === 'constitution' || c.category === 'equivalent' || c.category === 'risk' ? 'architecture' : c.category,
      blocking: true,
      affects: [c.topic],
      options,
      claude: { recommendation: options.find((o) => o.key === 'claude')?.key ?? null, rationale: c.claude_position },
      codex: { recommendation: options.find((o) => o.key === 'codex')?.key ?? null, rationale: c.codex_position },
      status: 'split',
      suggested: null,
    });
  }
  return bounced;
}
