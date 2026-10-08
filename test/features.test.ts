import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { engine, features, state } from './impl.ts';
import { drive, FakeAgent, gitRepo, makeRun, readJson } from './helpers.ts';

const entry = (run: string, feature: string, n: string, slug: string) => ({ run, feature, spec_dir: `specs/${n}-${slug}`, branch: `duetto/${run}/${feature}-${slug}`, worktree: `/wt/${run}/${feature}` });

test("features resolve in Spec Kit's order: flag, SPECIFY_* env, .specify/feature.json, branch, then the current run", () => {
  const repo = mkdtempSync(join(tmpdir(), 'duetto-feat-'));
  features.registerFeature(repo, entry('r1', 'F1', '001', 'login'));
  features.registerFeature(repo, entry('r1', 'F2', '002', 'signup'));
  features.registerFeature(repo, entry('r2', 'F1', '003', 'farewell'));
  state.setCurrentRun(repo, 'r1');
  const pick = (o: any) => features.resolveFeature(repo, { env: {}, ...o }).spec_dir;
  assert.equal(pick({ flag: '002' }), 'specs/002-signup');
  assert.equal(pick({ flag: 'farewell' }), 'specs/003-farewell');
  assert.equal(pick({ flag: 'specs/001-login/' }), 'specs/001-login');
  assert.equal(pick({ flag: 'F2' }), 'specs/002-signup', 'F-ids are relative to the current run');
  assert.throws(() => pick({ flag: 'nope' }), /No duetto feature matches "nope"\. Known: 001-login, 002-signup, 003-farewell/);
  assert.equal(pick({ env: { SPECIFY_FEATURE_DIRECTORY: '/abs/repo/specs/003-farewell' } }), 'specs/003-farewell');
  assert.equal(pick({ env: { SPECIFY_FEATURE: '002-signup' } }), 'specs/002-signup');
  mkdirSync(join(repo, '.specify'));
  writeFileSync(join(repo, '.specify', 'feature.json'), JSON.stringify({ feature_directory: 'specs/003-farewell' }));
  assert.equal(pick({}), 'specs/003-farewell');
  assert.equal(pick({ flag: '001' }), 'specs/001-login', 'flag beats feature.json');
  writeFileSync(join(repo, '.specify', 'feature.json'), '{}');
  assert.equal(pick({ branch: 'duetto/r2/F1-farewell' }), 'specs/003-farewell');
  assert.equal(pick({ branch: 'main' }), 'specs/001-login', 'falls back to the current run');
  assert.equal(features.highestReserved(repo), 3);
});

test('duetto specify: single-feature run with no decomposition gate, registered and numbered past reserved features', async () => {
  const repo = gitRepo();
  const ctx = makeRun(repo, { claude: new FakeAgent('claude'), codex: new FakeAgent('codex') }, { depth: 'quick' });
  features.registerFeature(repo, entry('other-run', 'F1', '004', 'elsewhere'));
  writeFileSync(join(ctx.dir, 'request.md'), 'Add a farewell function\nwith locales\n');
  ctx.state.mode = 'single';
  const visited = await drive(ctx, (_s: any, b: any) => b, () => 'suggested', 200, { phase: 'specify', feature: 'F1' });
  assert.equal(ctx.state.status, 'paused');
  assert.ok(!visited.includes('decompose-approve'), 'no split to approve');
  assert.deepEqual(readJson(join(ctx.dir, 'decomposition.json')).features.map((f: any) => [f.id, f.slug, f.title]), [['F1', 'add-a-farewell-function-with-locales', 'Add a farewell function']]);
  const meta = readJson(join(ctx.dir, 'features', 'F1', 'feature.json'));
  assert.match(meta.specDir, /specs\/005-add-a-farewell-function-with-locales$/, 'numbered after the reserved 004');
  assert.equal(features.resolveFeature(repo, { flag: '005', env: {} }).run, ctx.state.id);
  assert.ok(readJson(join(ctx.dir, 'features', 'F1', 'spec.json')), 'spec drafted');
  assert.ok(!engine.locate(ctx).done.some((s: any) => s.phase === 'clarify'), 'stopped before clarify');
  assert.match(ctx.state.message, /run `duetto clarify` to continue/);
});
