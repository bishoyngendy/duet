// JSON artifacts → human-readable markdown (Spec Kit–style files under specs/NNN-slug/).

const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '_None._');

export function renderDecomposition(d: any): string {
  return [
    '# Feature decomposition',
    d.rationale,
    ...d.features.map(
      (f: any) =>
        `## ${f.id} — ${f.title} (\`${f.slug}\`)\n${f.summary}\n\n**Scope:** ${f.scope}\n\n**Depends on:** ${f.depends_on.join(', ') || 'nothing'}`,
    ),
  ].join('\n\n');
}

export function renderResearch(r: any): string {
  return [
    '# Research',
    r.summary,
    '## Recommended approach',
    r.recommended_approach,
    '## Consensus',
    list(r.consensus),
    '## Disagreements',
    r.disagreements.length
      ? r.disagreements.map((x: any) => `### ${x.topic}\n- **Claude:** ${x.claude}\n- **Codex:** ${x.codex}\n- **Assessment:** ${x.assessment}`).join('\n\n')
      : '_None._',
    '## Key files',
    list(r.key_files.map((f: any) => `\`${f.path}\` — ${f.why}`)),
    '## Risks',
    list(r.risks),
    '## Open questions',
    list(r.open_questions),
  ].join('\n\n');
}

export function renderSpec(s: any): string {
  return [
    `# Spec: ${s.title}`,
    s.summary,
    '## User stories',
    list(s.user_stories.map((u: any) => `**${u.id}** As a ${u.as_a}, I want ${u.i_want}, so that ${u.so_that}.`)),
    '## Functional requirements',
    list(s.functional_requirements.map((r: any) => `**${r.id}** ${r.text}`)),
    '## Non-functional requirements',
    list(s.non_functional_requirements.map((r: any) => `**${r.id}** ${r.text}`)),
    '## Acceptance criteria',
    list(s.acceptance_criteria.map((a: any) => `**${a.id}** Given ${a.given}, when ${a.when}, then ${a.then}.`)),
    '## Edge cases',
    list(s.edge_cases),
    '## Out of scope',
    list(s.out_of_scope),
    '## Assumptions',
    list(s.assumptions),
  ].join('\n\n');
}

export function renderPlan(p: any, extra?: { conflicts?: any[]; accepted?: any[]; rejected?: any[] }): string {
  const parts = [
    '# Implementation plan',
    p.summary,
    '## Architecture',
    p.architecture,
    '## Components',
    list(p.components.map((c: any) => `**${c.name}** — ${c.responsibility}${c.files.length ? ` (${c.files.map((f: string) => `\`${f}\``).join(', ')})` : ''}`)),
    '## Data model',
    p.data_model,
    '## Decisions',
    p.decisions.length
      ? p.decisions.map((d: any) => `### ${d.topic}\n**Choice:** ${d.choice}\n\n${d.rationale}${d.alternatives.length ? `\n\n_Alternatives:_ ${d.alternatives.join('; ')}` : ''}`).join('\n\n')
      : '_None._',
    '## File changes',
    list(p.file_changes.map((f: any) => `\`${f.path}\` (${f.change}) — ${f.description}`)),
    '## Testing strategy',
    p.testing_strategy,
    '## Risks',
    list(p.risks.map((r: any) => `${r.risk} → _${r.mitigation}_`)),
    '## Rollout',
    p.rollout,
  ];
  if (extra?.conflicts?.length) {
    parts.push(
      '## Claude vs Codex conflicts',
      extra.conflicts
        .map((c: any) => `### ${c.id} — ${c.topic} [${c.category}, ${c.status}]\n- **Claude:** ${c.claude_position}\n- **Codex:** ${c.codex_position}\n- **Resolution:** ${c.resolution ?? 'decided by user — see decisions.md'}`)
        .join('\n\n'),
    );
  }
  if (extra?.accepted?.length || extra?.rejected?.length) {
    parts.push(
      '## Challenge outcomes',
      list([
        ...(extra.accepted ?? []).map((a: any) => `✅ ${a.source} ${a.id}: ${a.change_made}`),
        ...(extra.rejected ?? []).map((r: any) => `❌ ${r.source} ${r.id}: ${r.reason}`),
      ]),
    );
  }
  return parts.join('\n\n');
}

export function renderTasks(t: any, assignments: Record<string, string>): string {
  return [
    '# Tasks',
    ...t.tasks.map(
      (task: any) =>
        `## ${task.id} — ${task.title}\n_Implementer: ${assignments[task.id] ?? '?'} · depends on: ${task.depends_on.join(', ') || 'nothing'}_\n\n${task.description}\n\n**Files:** ${task.files_in_scope.map((f: string) => `\`${f}\``).join(', ') || '—'}\n\n**Acceptance:**\n${list(task.acceptance)}${task.test_command ? `\n\n**Test:** \`${task.test_command}\`` : ''}`,
    ),
  ].join('\n\n');
}

export function renderDecisions(entries: { phase: string; questions: any[]; answers: any[] }[]): string {
  const out = ['# Decisions'];
  for (const e of entries) {
    out.push(`## ${e.phase}`);
    for (const a of e.answers) {
      const q = e.questions.find((x: any) => x.id === a.id);
      const recs = q
        ? [q.claude && `Claude → ${q.claude.recommendation ?? '—'}`, q.codex && `Codex → ${q.codex.recommendation ?? '—'}`].filter(Boolean).join(' · ')
        : '';
      out.push(`- **${a.id}** ${a.question}\n  - **Decision:** ${a.label}${recs ? `\n  - _${recs}_` : ''}`);
    }
  }
  return out.join('\n\n');
}

export function renderReport(r: {
  feature: any;
  tasks: { id: string; title: string; implementer: string; reviewer: string; rounds: number; accepted_with_issues: boolean; sha: string | null }[];
  converge: any;
  checks: any;
}): string {
  return [
    `# Report: ${r.feature.id} — ${r.feature.title}`,
    `**Convergence:** ${r.converge.status} — ${r.converge.summary}`,
    '## Tasks',
    '| Task | Implementer | Reviewer | Rounds | Result |\n|---|---|---|---|---|\n' +
      r.tasks
        .map((t) => `| ${t.id} ${t.title} | ${t.implementer} | ${t.reviewer} | ${t.rounds} | ${t.accepted_with_issues ? '⚠️ accepted with issues' : '✅ approved'} ${t.sha ? `\`${t.sha.slice(0, 8)}\`` : ''} |`)
        .join('\n'),
    '## Acceptance criteria',
    list(r.converge.acceptance.map((a: any) => `${a.met ? '✅' : '❌'} **${a.id}** ${a.evidence}`)),
    '## Open findings',
    list(r.converge.findings.map((f: any) => `[${f.severity}] ${f.file ? `\`${f.file}\` ` : ''}${f.issue}`)),
    '## Final checks',
    r.checks ? list(r.checks.commands.map((c: any) => `${c.exit_code === 0 ? '✅' : '❌'} \`${c.cmd}\``)) : '_Not run._',
  ].join('\n\n');
}
