import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from './impl.ts';

const spec = {
  title: 'Farewells',
  summary: 'Say goodbye.',
  user_stories: [
    { id: 'US1', title: 'Basic farewell', priority: 'P1', story: 'A user says bye.', why_priority: 'Core.', independent_test: 'Call farewell("x").' },
    { id: 'US2', title: 'Localised', priority: 'P2', story: 'In French.', why_priority: 'Nice.', independent_test: 'Call with fr.' },
  ],
  functional_requirements: [{ id: 'FR-001', text: 'System MUST return "bye x".' }],
  non_functional_requirements: [],
  key_entities: [],
  acceptance_criteria: [
    { id: 'AC-001', story: 'US1', given: 'a name', when: 'farewell is called', then: 'it returns bye' },
    { id: 'AC-002', story: null, given: 'no name', when: 'called', then: 'it throws' },
  ],
  success_criteria: [{ id: 'SC-001', text: 'Works for 100% of ASCII names' }],
  edge_cases: ['empty name'],
  out_of_scope: ['emoji'],
  assumptions: ['English default'],
  needs_clarification: ['Which locales?'],
  extra_sections: [{ heading: 'Glossary', body: 'farewell = goodbye' }],
};

test("spec.md follows Spec Kit's spec template", () => {
  const md = render.renderSpec(spec, { branch: '001-farewells', request: 'add farewells', date: '2026-10-08' });
  for (const h of ['# Feature Specification: Farewells', '**Feature Branch**: `001-farewells`', '**Status**: Draft', '**Input**: User description: "add farewells"', '## User Scenarios & Testing', '### User Story 1 - Basic farewell (Priority: P1) 🎯 MVP', '**Independent Test**: Call farewell("x").', '### Edge Cases', '## Requirements', '### Functional Requirements', '- **FR-001**: System MUST return "bye x".', '## Success Criteria', '- **SC-001**: Works', '## Assumptions', '[NEEDS CLARIFICATION: Which locales?]', '## Glossary']) {
    assert.ok(md.includes(h), `missing ${h}`);
  }
  assert.match(md, /\*\*Acceptance Scenarios\*\*:\n\n1\. \*\*Given\*\* a name, \*\*When\*\* farewell is called, \*\*Then\*\* it returns bye _\(AC-001\)_/);
  assert.match(md, /### Acceptance Criteria\n\n1\. \*\*Given\*\* no name/, 'criteria not tied to a story are listed separately');
  assert.ok(md.indexOf('User Story 1') < md.indexOf('User Story 2'));
});

test('specs and plans from before the Spec Kit fields still render', () => {
  const legacy = { title: 'T', summary: 's', user_stories: [{ id: 'US1', as_a: 'dev', i_want: 'x', so_that: 'y' }], functional_requirements: [], non_functional_requirements: [], acceptance_criteria: [{ id: 'AC-001', given: 'g', when: 'w', then: 't' }], edge_cases: [], out_of_scope: [], assumptions: [] };
  assert.match(render.renderSpec(legacy), /As a dev, I want x, so that y\./);
  const plan = { summary: 's', architecture: 'a', components: [], data_model: 'none', decisions: [], file_changes: [], testing_strategy: 't', risks: [], rollout: 'none', open_questions: [] };
  assert.match(render.renderPlan(plan), /## Architecture/);
  assert.deepEqual(render.planFiles(plan, 'T'), {});
});

test('plan.md has Spec Kit sections and writes data-model, quickstart and contracts files', () => {
  const plan = {
    summary: 'Add farewell()',
    technical_context: { language: 'TypeScript 5', dependencies: 'none', storage: 'N/A', testing: 'node:test', platform: 'Node 22', project_type: 'library', performance_goals: 'N/A', constraints: 'N/A', scale: 'tiny' },
    constitution_check: [{ principle: 'Simplicity', status: 'pass', note: 'one function' }, { principle: 'No new deps', status: 'justified', note: 'needs Intl' }],
    project_structure: 'src/\n└── greet.ts',
    architecture: 'a', components: [], data_model: 'Locale table', decisions: [], file_changes: [], testing_strategy: 't', risks: [], rollout: 'none',
    contracts: [{ path: '../../escape.md', content: 'farewell(name: string): string' }],
    quickstart: 'Run farewell("x")', open_questions: [], extra_sections: [],
  };
  const md = render.renderPlan(plan, undefined, { title: 'Farewells', branch: '001-farewells', date: '2026-10-08' });
  for (const h of ['# Implementation Plan: Farewells', '**Branch**: `001-farewells` | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)', '## Technical Context', '**Language/Version**: TypeScript 5', '## Constitution Check', '| Simplicity | ✅ pass | one function |', '## Project Structure', '├── data-model.md', '├── contracts/', 'src/\n└── greet.ts', '## Complexity Tracking', '| No new deps | needs Intl |']) {
    assert.ok(md.includes(h), `missing ${h}`);
  }
  assert.deepEqual(Object.keys(render.planFiles(plan, 'Farewells')).sort(), ['contracts/escape.md', 'data-model.md', 'quickstart.md'], 'contract paths cannot escape contracts/');
});

test("tasks.md uses Spec Kit's task line format, phases, [P] from waves and [X] for done", () => {
  const t = (id: string, phase: string, story: string | null, deps: string[] = []) => ({ id, title: `Task ${id}`, phase, story, description: 'd', depends_on: deps, files_in_scope: [`src/${id}.ts`], acceptance: ['works'], test_command: null });
  const tasks = { tasks: [t('T001', 'setup', null), t('T002', 'foundational', null, ['T001']), t('T003', 'story', 'US1', ['T002']), t('T004', 'story', 'US2', ['T002']), t('T005', 'polish', null, ['T003', 'T004'])] };
  const md = render.renderTasks(tasks, { assignments: { T001: 'claude' }, spec, waves: [['T001'], ['T002'], ['T003', 'T004'], ['T005']], done: new Set(['T001']), specDir: 'specs/001-farewells' });
  const lines = md.split('\n').filter((l: string) => /^- \[/.test(l));
  assert.equal(lines.length, 5);
  for (const l of lines) assert.match(l, /^- \[( |X)\] T\d{3}( \[P\])?( \[US\d+\])? \S/, l);
  assert.match(md, /- \[X\] T001 Task T001 — `src\/T001.ts`/);
  assert.match(md, /- \[ \] T003 \[P\] \[US1\] Task T003/);
  assert.match(md, /- \[ \] T004 \[P\] \[US2\] Task T004/);
  const order = ['## Phase 1: Setup', '## Phase 2: Foundational', '## Phase 3: User Story 1 - Basic farewell (Priority: P1) 🎯 MVP', '**Checkpoint**: User Story 1', '## Phase 4: User Story 2 - Localised (Priority: P2)', '## Phase 5: Polish', '## Dependencies & Execution Order', 'Wave 3: T003 ∥ T004'];
  let at = -1;
  for (const h of order) {
    const i = md.indexOf(h);
    assert.ok(i > at, `${h} out of order`);
    at = i;
  }
});
