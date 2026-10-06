import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { engine, util } from './impl.ts';
import { drive, FakeAgent, git, gitRepo, makeRun, readJson, type GateScript, type HostScript } from './helpers.ts';

const { advance, answer, locate, submit } = engine;
const { writeJson } = util;

const question = {
  id: 'Q1',
  text: 'Can a checkpoint be skipped?',
  category: 'product',
  blocking: true,
  affects: ['state machine'],
  options: [
    { key: 'A', label: 'No', description: '' },
    { key: 'B', label: 'Yes', description: '' },
  ],
  claude: { recommendation: 'B', rationale: 'r' },
  codex: { recommendation: 'B', rationale: 'r' },
  status: 'consensus',
  suggested: 'B',
};

const tasks = [
  { id: 'T001', title: 'Core', description: 'd', depends_on: [], files_in_scope: ['src/**'], acceptance: ['a'], test_command: null },
  { id: 'T002', title: 'Wire up', description: 'd', depends_on: ['T001'], files_in_scope: ['src/**'], acceptance: ['a'], test_command: 'true' },
];

const hostScript: HostScript = (step, base) => {
  switch (step.host!.schema) {
    case 'Decomposition':
      return { rationale: 'one feature', features: [{ id: 'F1', slug: 'thing', title: 'Thing', summary: 's', scope: 's', depends_on: [] }] };
    case 'MergedQuestions':
      return { questions: step.id.endsWith('clarify-1-merge') ? [question] : [] };
    case 'PlanSynthesis':
      return {
        ...base,
        conflicts: [
          // The host claims to have resolved an architecture conflict: the engine must escalate it.
          { id: 'C1', topic: 'State store', category: 'architecture', claude_position: 'zustand', codex_position: 'query', resolution: 'both', status: 'resolved', options: [] },
          { id: 'C2', topic: 'Naming', category: 'equivalent', claude_position: 'a', codex_position: 'b', resolution: 'a', status: 'resolved', options: [] },
        ],
      };
    case 'Tasks':
      return { tasks };
    default:
      return base;
  }
};

/** Answers the escalated conflict (no suggestion by design), then defers to `rest`. */
const withConflict =
  (rest: GateScript): GateScript =>
  (step) =>
    step.gate!.questions.some((q) => q.id === 'D-C1') ? { 'D-C1': 'codex' } : rest(step);
const gateScript = withConflict(() => 'suggested');

function implementerWrites(call: any, base: any) {
  if (call.role === 'implementer') writeFileSync(join(call.cwd, 'src', `${call.label}.txt`), 'impl\n');
  return base;
}

test('full pipeline: research → clarify → plan (escalation) → challenge → alternating implement/review → converge', async () => {
  const repo = gitRepo();
  const claude = new FakeAgent('claude', implementerWrites);
  const codex = new FakeAgent('codex', (call, base) => {
    implementerWrites(call, base);
    if (call.role === 'reviewer' && call.label.includes('T001__r1__review')) {
      return { ...base, status: 'changes_required', findings: [{ id: 'F1', severity: 'high', file: 'src/index.ts', line: 1, issue: 'bug', required_change: 'fix' }] };
    }
    return base;
  });
  const ctx = makeRun(repo, { claude, codex });
  const visited = await drive(ctx, hostScript, gateScript);

  assert.equal(ctx.state.status, 'done');
  assert.ok(visited.includes('decompose-approve'));
  assert.ok(visited.includes('F1/clarify-1-answers'));
  assert.ok(!visited.includes('F1/clarify-2-answers'), 'round 2 had no questions');
  assert.ok(visited.includes('F1/plan-synthesis-decisions'), 'architecture conflict escalated to the user');

  const FD = join(ctx.dir, 'features', 'F1');
  const synth = readJson(join(FD, 'plan-synthesis.json'));
  assert.equal(synth.conflicts.find((c: any) => c.id === 'C1').status, 'needs_user');
  assert.equal(synth.conflicts.find((c: any) => c.id === 'C2').status, 'resolved');
  assert.equal(readJson(join(FD, 'plan-decisions.json')).answers[0].choice, 'codex');
  assert.ok(existsSync(join(FD, 'research-rebuttal.claude.json')));
  assert.ok(existsSync(join(FD, 'challenge.codex.json')));

  // Alternation + review loop
  assert.equal(readJson(join(FD, 'tasks', 'T001', 'base.json')).implementer, 'claude');
  assert.equal(readJson(join(FD, 'tasks', 'T002', 'base.json')).implementer, 'codex');
  assert.equal(readJson(join(FD, 'tasks', 'T001', 'commit.json')).rounds, 2);
  assert.equal(readJson(join(FD, 'tasks', 'T002', 'commit.json')).rounds, 1);
  const impl2 = readJson(join(FD, 'tasks', 'T001', 'impl-2.json'));
  assert.ok(impl2);
  const prompt2 = claude.calls.find((c) => c.label.includes('T001__r2__implement'))!.prompt;
  assert.match(prompt2, /review_findings_to_address/);

  // Permissions: reviewers never writable, implementers always writable
  for (const c of [...claude.calls, ...codex.calls]) {
    assert.equal(c.writable, c.role === 'implementer', `${c.label} writable=${c.writable}`);
  }
  // Independence: both models receive byte-identical research prompts
  const rc = claude.calls.find((c) => c.label.startsWith('F1__research.'))!.prompt;
  const rx = codex.calls.find((c) => c.label.startsWith('F1__research.'))!.prompt;
  assert.equal(rc, rx);

  // Git: stacked commits on the feature branch with spec artifacts
  const meta = readJson(join(FD, 'feature.json'));
  const log = git(meta.worktree, 'log', '--format=%s');
  assert.match(log, /docs\(001\): spec, plan and tasks/);
  assert.match(log, /feat\(001\/T001\): Core/);
  assert.match(log, /feat\(001\/T002\): Wire up/);
  assert.match(log, /docs\(001\): duet report/);
  for (const f of ['spec.md', 'plan.md', 'tasks.md', 'research.md', 'decisions.md', 'report.md']) {
    assert.ok(existsSync(join(meta.specDir, f)), `${f} exists`);
  }
  assert.equal(git(meta.worktree, 'status', '--porcelain'), '');
  assert.equal(git(repo, 'status', '--porcelain', '--', 'src'), '', 'main working tree untouched');
});

test('quick depth skips rebuttals and challenge', async () => {
  const repo = gitRepo();
  const ctx = makeRun(repo, { claude: new FakeAgent('claude', implementerWrites), codex: new FakeAgent('codex', implementerWrites) }, { depth: 'quick' });
  await drive(ctx, (s, b) => (s.host!.schema === 'PlanSynthesis' ? b : hostScript(s, b)), () => 'suggested');
  const FD = join(ctx.dir, 'features', 'F1');
  assert.equal(ctx.state.status, 'done');
  assert.ok(!existsSync(join(FD, 'research-rebuttal.claude.json')));
  assert.ok(!existsSync(join(FD, 'challenge.claude.json')));
  assert.ok(existsSync(join(FD, 'plan.json')));
});

test('reviewer that modifies the worktree is rejected and reverted; rerun recovers', async () => {
  const repo = gitRepo();
  let misbehave = true;
  const codex = new FakeAgent('codex', (call, base) => {
    implementerWrites(call, base);
    if (call.role === 'reviewer' && misbehave) writeFileSync(join(call.cwd, 'src', 'sneaky-fix.ts'), 'oops\n');
    return base;
  });
  const ctx = makeRun(repo, { claude: new FakeAgent('claude', implementerWrites), codex }, { depth: 'quick' });
  await assert.rejects(drive(ctx, hostScript, gateScript), /modified the worktree/);
  const meta = readJson(join(ctx.dir, 'features', 'F1', 'feature.json'));
  assert.ok(!existsSync(join(meta.worktree, 'src', 'sneaky-fix.ts')), 'reviewer change reverted');
  assert.ok(!existsSync(join(ctx.dir, 'features', 'F1', 'tasks', 'T001', 'review-1.json')));
  misbehave = false;
  await drive(ctx, hostScript, gateScript);
  assert.equal(ctx.state.status, 'done');
});

test('review that never converges escalates to the user; accept commits with issues', async () => {
  const repo = gitRepo();
  const blocker = (call: any, base: any) => {
    implementerWrites(call, base);
    if (call.role === 'reviewer') return { ...base, status: 'approved', findings: [{ id: 'X', severity: 'medium', file: null, line: null, issue: 'i', required_change: 'c' }] };
    return base;
  };
  const ctx = makeRun(repo, { claude: new FakeAgent('claude', blocker), codex: new FakeAgent('codex', blocker) }, { depth: 'quick', config: { max_review_rounds: 2 } });
  const visited = await drive(ctx, hostScript, withConflict((step) => (step.gate!.questions[0].id === 'REVIEW' ? { REVIEW: 'accept' } : 'suggested')));
  assert.ok(visited.includes('F1/T001/escalation-1'));
  const FD = join(ctx.dir, 'features', 'F1');
  const commit = readJson(join(FD, 'tasks', 'T001', 'commit.json'));
  assert.equal(commit.accepted_with_issues, true);
  assert.equal(commit.rounds, 2, '"approved" with a medium finding is downgraded to changes_required');
});

test('rejecting the decomposition with feedback re-runs decompose with the feedback as input', async () => {
  const repo = gitRepo();
  const ctx = makeRun(repo, { claude: new FakeAgent('claude', implementerWrites), codex: new FakeAgent('codex', implementerWrites) }, { depth: 'quick' });
  let rejected = false;
  const visited = await drive(
    ctx,
    hostScript,
    withConflict((step) => {
      if (step.id === 'decompose-approve' && !rejected) {
        rejected = true;
        return { SPLIT: 'merge everything into one feature' };
      }
      return 'suggested';
    }),
  );
  assert.equal(visited.filter((v) => v === 'decompose').length, 2);
  assert.ok(existsSync(join(ctx.dir, 'decomposition.rejected-1.json')));
  assert.ok(existsSync(join(ctx.dir, 'decompose-feedback.md')));
});

test('submit and answer validate their input', async () => {
  const repo = gitRepo();
  const ctx = makeRun(repo, { claude: new FakeAgent('claude'), codex: new FakeAgent('codex') });
  assert.equal(await advance(ctx), 'needs_synthesis');
  const bad = join(ctx.dir, 'host', 'bad.json');
  writeJson(bad, { features: [] });
  await assert.rejects(submit(ctx, bad), /rationale: required/);
  writeJson(bad, { rationale: 'r', features: [] });
  await assert.rejects(submit(ctx, bad), /At least one feature/);
  writeJson(bad, { rationale: 'r', features: [{ id: 'F1', slug: 'a', title: 't', summary: 's', scope: 's', depends_on: ['F9'] }] });
  await assert.rejects(submit(ctx, bad), /unknown id "F9"/);
  writeJson(bad, { rationale: 'r', features: [{ id: 'F1', slug: 'a', title: 't', summary: 's', scope: 's', depends_on: [] }] });
  await submit(ctx, bad);
  assert.equal(await advance(ctx), 'needs_answers');
  await assert.rejects(answer(ctx, {}), /Missing answers for: SPLIT/);
  await assert.rejects(answer(ctx, { NOPE: 'x' }), /Unknown question id/);
  await answer(ctx, { SPLIT: 'APPROVE' });
  assert.equal(locate(ctx).step!.id, 'F1/setup');
});

test('convergence issues → user picks fix → FIX task implemented by the other model, then re-audited', async () => {
  const repo = gitRepo();
  let audits = 0;
  const behaviour = (call: any, base: any) => {
    implementerWrites(call, base);
    if (call.role === 'converger' && audits++ === 0) {
      return { ...base, status: 'issues', summary: 'AC-001 unmet', acceptance: [{ id: 'AC-001', met: false, evidence: 'no test' }], findings: [] };
    }
    return base;
  };
  const claude = new FakeAgent('claude', behaviour);
  const codex = new FakeAgent('codex', behaviour);
  const ctx = makeRun(repo, { claude, codex }, { depth: 'quick' });
  const visited = await drive(ctx, hostScript, withConflict(() => 'suggested'));
  assert.ok(visited.includes('F1/converge-1-decision'));
  const FD = join(ctx.dir, 'features', 'F1');
  const fix = readJson(join(FD, 'tasks', 'FIX1', 'base.json'));
  assert.equal(fix.implementer, 'codex', 'tasks split 1/1, so claude audits and codex fixes');
  assert.equal(readJson(join(FD, 'converge-2.json')).status, 'converged');
  const meta = readJson(join(FD, 'feature.json'));
  assert.match(git(meta.worktree, 'log', '--format=%s'), /FIX1/);
});

test('approved review with low findings triggers exactly one polish round', async () => {
  const repo = gitRepo();
  const low = { id: 'L1', severity: 'low', file: 'src/a.ts', line: 1, issue: 'invisible chars', required_change: 'use \\u escapes' };
  const reviewer = (call: any, base: any) => {
    implementerWrites(call, base);
    // T001: low finding on every review → polish once, then accept. T002: clean.
    if (call.role === 'reviewer' && call.label.includes('T001')) return { ...base, status: 'approved', findings: [low] };
    return base;
  };
  const claude = new FakeAgent('claude', reviewer);
  const codex = new FakeAgent('codex', reviewer);
  const ctx = makeRun(repo, { claude, codex }, { depth: 'quick' });
  await drive(ctx, hostScript, withConflict(() => 'suggested'));
  const FD = join(ctx.dir, 'features', 'F1');
  assert.equal(readJson(join(FD, 'tasks', 'T001', 'commit.json')).rounds, 2, 'one polish round, then stop');
  assert.equal(readJson(join(FD, 'tasks', 'T002', 'commit.json')).rounds, 1);
  const polishPrompt = claude.calls.find((c) => c.label.includes('T001__r2__implement'))!.prompt;
  assert.match(polishPrompt, /polish_round/);
  assert.match(polishPrompt, /approved your work but raised minor findings/);
});

test('polish can be disabled', async () => {
  const repo = gitRepo();
  const reviewer = (call: any, base: any) => {
    implementerWrites(call, base);
    if (call.role === 'reviewer') return { ...base, status: 'approved', findings: [{ id: 'L', severity: 'low', file: null, line: null, issue: 'i', required_change: 'c' }] };
    return base;
  };
  const ctx = makeRun(repo, { claude: new FakeAgent('claude', reviewer), codex: new FakeAgent('codex', reviewer) }, { depth: 'quick', config: { review: { blocking: ['critical', 'high', 'medium'], polish: ['low'], polish_rounds: 0 } } });
  await drive(ctx, hostScript, withConflict(() => 'suggested'));
  assert.equal(readJson(join(ctx.dir, 'features', 'F1', 'tasks', 'T001', 'commit.json')).rounds, 1);
});
