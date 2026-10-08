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

export type DocMeta = { branch?: string; request?: string; date?: string; status?: string };

/** Template sections with no field of their own, minus any heading the renderer already produced. */
function sections(extra: any[] | undefined, parts: string[]): string[] {
  const norm = (h: string) => h.replace(/^#+\s*/, '').trim().toLowerCase();
  const have = new Set(parts.filter((p) => /^#+ /.test(p)).map(norm));
  return (extra ?? []).filter((x: any) => !have.has(norm(x.heading))).flatMap((x: any) => [`## ${x.heading}`, x.body]);
}
const scenario = (a: any) => `**Given** ${a.given}, **When** ${a.when}, **Then** ${a.then} _(${a.id})_`;

/** spec.md in Spec Kit's layout (spec-template.md). Specs from before Spec Kit fields render too. */
export function renderSpec(s: any, meta: DocMeta = {}): string {
  const acs: any[] = s.acceptance_criteria ?? [];
  const stories = (s.user_stories ?? []).map((u: any, i: number) => {
    if (!u.priority) return `### ${u.id}\nAs a ${u.as_a}, I want ${u.i_want}, so that ${u.so_that}.`;
    const own = acs.filter((a) => a.story === u.id);
    return [
      `### User Story ${i + 1} - ${u.title} (Priority: ${u.priority})${u.priority === 'P1' ? ' 🎯 MVP' : ''}`,
      u.story,
      `**Why this priority**: ${u.why_priority}`,
      `**Independent Test**: ${u.independent_test}`,
      `**Acceptance Scenarios**:\n\n${own.length ? own.map((a, j) => `${j + 1}. ${scenario(a)}`).join('\n') : '_See acceptance criteria below._'}`,
    ].join('\n\n');
  });
  const loose = acs.filter((a) => !a.story || !(s.user_stories ?? []).some((u: any) => u.id === a.story && u.priority));
  const parts = [
    `# Feature Specification: ${s.title}`,
    [
      meta.branch && `**Feature Branch**: \`${meta.branch}\``,
      meta.date && `**Created**: ${meta.date}`,
      `**Status**: ${meta.status ?? 'Draft'}`,
      meta.request && `**Input**: User description: "${meta.request.trim()}"`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    s.summary,
    '## User Scenarios & Testing',
    ...(stories.length ? stories.flatMap((x: string) => [x, '---']) : ['_None._']),
    '### Edge Cases',
    list(s.edge_cases ?? []),
    '## Requirements',
    '### Functional Requirements',
    list((s.functional_requirements ?? []).map((r: any) => `**${r.id}**: ${r.text}`)),
    ...((s.non_functional_requirements ?? []).length ? ['### Non-Functional Requirements', list(s.non_functional_requirements.map((r: any) => `**${r.id}**: ${r.text}`))] : []),
    ...((s.key_entities ?? []).length ? ['### Key Entities', list(s.key_entities.map((e: any) => `**${e.name}**: ${e.description}`))] : []),
    ...(loose.length ? ['### Acceptance Criteria', loose.map((a, j) => `${j + 1}. ${scenario(a)}`).join('\n')] : []),
    ...((s.success_criteria ?? []).length ? ['## Success Criteria', '### Measurable Outcomes', list(s.success_criteria.map((c: any) => `**${c.id}**: ${c.text}`))] : []),
    '## Assumptions',
    list(s.assumptions ?? []),
    '## Out of Scope',
    list(s.out_of_scope ?? []),
    ...((s.needs_clarification ?? []).length ? ['## Open Questions', list(s.needs_clarification.map((q: string) => `[NEEDS CLARIFICATION: ${q}]`))] : []),
  ];
  return [...parts, ...sections(s.extra_sections, parts)].join('\n\n');
}

const notNone = (v: string | undefined) => Boolean(v && !/^\s*(none|n\/a)\.?\s*$/i.test(v));

/** plan.md in Spec Kit's layout (plan-template.md), plus duetto's design detail and Claude-vs-Codex record. */
export function renderPlan(p: any, extra?: { conflicts?: any[]; accepted?: any[]; rejected?: any[] }, meta: DocMeta & { title?: string } = {}): string {
  const tc = p.technical_context;
  const docs = ['plan.md', 'research.md', notNone(p.data_model) && 'data-model.md', notNone(p.quickstart) && 'quickstart.md', p.contracts?.length && 'contracts/', 'tasks.md'].filter(Boolean);
  const parts = [
    `# Implementation Plan: ${meta.title ?? p.summary.split('\n')[0].slice(0, 80)}`,
    [meta.branch && `**Branch**: \`${meta.branch}\``, meta.date && `**Date**: ${meta.date}`, '**Spec**: [spec.md](spec.md)'].filter(Boolean).join(' | '),
    '## Summary',
    p.summary,
  ];
  if (tc) {
    parts.push(
      '## Technical Context',
      [
        ['Language/Version', tc.language],
        ['Primary Dependencies', tc.dependencies],
        ['Storage', tc.storage],
        ['Testing', tc.testing],
        ['Target Platform', tc.platform],
        ['Project Type', tc.project_type],
        ['Performance Goals', tc.performance_goals],
        ['Constraints', tc.constraints],
        ['Scale/Scope', tc.scale],
      ]
        .map(([k, v]) => `**${k}**: ${v}`)
        .join('\n\n'),
    );
  }
  if (p.constitution_check) {
    const mark = { pass: '✅ pass', violation: '❌ violation', justified: '⚠️ justified' } as Record<string, string>;
    parts.push(
      '## Constitution Check',
      p.constitution_check.length ? '| Principle | Status | Note |\n|---|---|---|\n' + p.constitution_check.map((c: any) => `| ${c.principle} | ${mark[c.status]} | ${c.note} |`).join('\n') : '_No principles affected._',
    );
  }
  if (p.project_structure) {
    parts.push(
      '## Project Structure',
      '### Documentation (this feature)',
      '```text\n' + docs.map((d) => `├── ${d}`).join('\n') + '\n```',
      '### Source Code',
      notNone(p.project_structure) && !/^\s*unchanged\.?\s*$/i.test(p.project_structure) ? '```text\n' + p.project_structure + '\n```' : '_Unchanged._',
    );
  }
  parts.push(
    '## Architecture',
    p.architecture,
    '## Components',
    list(p.components.map((c: any) => `**${c.name}** — ${c.responsibility}${c.files.length ? ` (${c.files.map((f: string) => `\`${f}\``).join(', ')})` : ''}`)),
    '## Data model',
    notNone(p.data_model) && p.contracts ? 'See [data-model.md](data-model.md).' : p.data_model,
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
  );
  const justified = (p.constitution_check ?? []).filter((c: any) => c.status !== 'pass');
  if (justified.length) {
    parts.push('## Complexity Tracking', '| Violation | Why Needed / Simpler Alternative Rejected Because |\n|---|---|\n' + justified.map((c: any) => `| ${c.principle} | ${c.note} |`).join('\n'));
  }
  parts.push(...sections(p.extra_sections, parts));
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

/** The extra Spec Kit design files a plan produces: data-model.md, quickstart.md and contracts/*. */
export function planFiles(p: any, title: string): Record<string, string> {
  const files: Record<string, string> = {};
  if (p.contracts === undefined) return files; // plan from before Spec Kit fields
  if (notNone(p.data_model)) files['data-model.md'] = `# Data Model: ${title}\n\n${p.data_model}\n`;
  if (notNone(p.quickstart)) files['quickstart.md'] = `# Quickstart: ${title}\n\n${p.quickstart}\n`;
  for (const c of p.contracts) files[`contracts/${c.path.replace(/^\/+|\.\.\/?/g, '')}`] = c.content.endsWith('\n') ? c.content : c.content + '\n';
  return files;
}

const PHASE_TITLES: Record<string, string> = { setup: 'Setup (Shared Infrastructure)', foundational: 'Foundational (Blocking Prerequisites)', polish: 'Polish & Cross-Cutting Concerns' };

/**
 * tasks.md in Spec Kit's format: `- [ ] T001 [P] [US1] …` lines grouped into Setup / Foundational / one phase per
 * user story / Polish. [P] marks tasks duetto runs concurrently (they share a wave); [X] marks committed tasks.
 */
export function renderTasks(t: any, o: { assignments: Record<string, string>; spec?: any; waves?: string[][]; done?: Set<string>; specDir?: string; title?: string }): string {
  const parallel = new Set((o.waves ?? []).filter((w) => w.length > 1).flat());
  const stories: any[] = (o.spec?.user_stories ?? []).filter((u: any) => u.priority);
  const line = (task: any) => {
    const files = task.files_in_scope.length ? ` — \`${task.files_in_scope.join('`, `')}\`` : '';
    const deps = task.depends_on.length ? ` (depends on ${task.depends_on.join(', ')})` : '';
    const head = `- [${o.done?.has(task.id) ? 'X' : ' '}] ${task.id}${parallel.has(task.id) ? ' [P]' : ''}${task.story ? ` [${task.story}]` : ''} ${task.title}${files}${deps}`;
    const detail = [task.description, ...task.acceptance.map((a: string) => `Acceptance: ${a}`), task.test_command && `Test: \`${task.test_command}\``, `Implementer: ${o.assignments[task.id] ?? '?'}`];
    return [head, ...detail.filter(Boolean).map((d: string) => `  - ${d.replace(/\n+/g, ' ')}`)].join('\n');
  };
  const out = [
    `# Tasks: ${o.title ?? o.spec?.title ?? 'feature'}`,
    `**Input**: Design documents from \`${o.specDir ?? 'specs/'}\``,
    '**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/',
    '## Format: `[ID] [P?] [Story] Description`\n\n- **[P]**: Can run in parallel — duetto implements these concurrently, each in its own worktree\n- **[Story]**: Which user story this task belongs to (e.g. US1)',
  ];
  const tasks: any[] = t.tasks;
  if (!tasks.some((x) => x.phase)) {
    out.push('## Tasks', tasks.map(line).join('\n'));
  } else {
    let n = 0;
    const phase = (title: string, items: any[], body: string[] = []) => items.length && out.push(`## Phase ${++n}: ${title}`, ...body, items.map(line).join('\n'));
    phase(PHASE_TITLES.setup, tasks.filter((x) => x.phase === 'setup'));
    phase(PHASE_TITLES.foundational, tasks.filter((x) => x.phase === 'foundational'), ['**⚠️ CRITICAL**: No user story work can begin until this phase is complete']);
    const storyIds = [...stories.map((u) => u.id), ...new Set(tasks.filter((x) => x.phase === 'story' && !stories.some((u) => u.id === x.story)).map((x) => x.story ?? '—'))];
    for (const id of storyIds) {
      const u = stories.find((x) => x.id === id);
      const items = tasks.filter((x) => x.phase === 'story' && (x.story ?? '—') === id);
      const num = stories.indexOf(u) + 1;
      if (!items.length) continue;
      if (u) {
        phase(`User Story ${num} - ${u.title} (Priority: ${u.priority})${u.priority === 'P1' ? ' 🎯 MVP' : ''}`, items, [`**Goal**: ${u.story}`, `**Independent Test**: ${u.independent_test}`]);
        out.push(`**Checkpoint**: User Story ${num} should be fully functional and testable independently`);
      } else phase(`Stories (${id})`, items);
    }
    phase(PHASE_TITLES.polish, tasks.filter((x) => x.phase === 'polish'));
  }
  out.push(
    '## Dependencies & Execution Order',
    list([
      ...tasks.filter((x) => x.depends_on.length).map((x) => `${x.id} after ${x.depends_on.join(', ')}`),
      ...(o.waves ?? []).map((w, i) => `Wave ${i + 1}: ${w.join(w.length > 1 ? ' ∥ ' : '')}`),
    ]),
  );
  return out.join('\n\n');
}

/** analysis.md in the shape of Spec Kit's analyze report. */
export function renderAnalysis(a: any): string {
  const covered = a.coverage.filter((c: any) => c.tasks.length).length;
  const count = (sev: string) => a.findings.filter((f: any) => f.severity === sev).length;
  return [
    '# Specification Analysis Report',
    '_Claude ∥ Codex audit of spec.md, plan.md and tasks.md before implementation._',
    a.findings.length
      ? '| ID | Category | Severity | Location | Summary | Recommendation | Found by |\n|---|---|---|---|---|---|---|\n' +
        a.findings.map((f: any) => `| ${f.id} | ${f.category} | ${f.severity.toUpperCase()} | ${f.location} | ${f.summary} | ${f.recommendation} | ${f.found_by} |`).join('\n')
      : '_No issues found._',
    '## Coverage Summary',
    a.coverage.length
      ? '| Requirement | Has task? | Tasks | Notes |\n|---|---|---|---|\n' + a.coverage.map((c: any) => `| ${c.requirement} | ${c.tasks.length ? '✅' : '❌'} | ${c.tasks.join(', ')} | ${c.note} |`).join('\n')
      : '_No requirements mapped._',
    ...(a.unmapped_tasks.length ? ['## Unmapped Tasks', list(a.unmapped_tasks)] : []),
    '## Metrics',
    list([
      `Requirements: ${a.coverage.length}`,
      `Coverage: ${a.coverage.length ? Math.round((100 * covered) / a.coverage.length) : 100}% (${covered}/${a.coverage.length} with ≥1 task)`,
      `Critical: ${count('critical')} · High: ${count('high')} · Medium: ${count('medium')} · Low: ${count('low')}`,
    ]),
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
