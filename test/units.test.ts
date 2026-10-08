import assert from 'node:assert/strict';
import { test } from 'node:test';
import { config, conflict, schema, schemas, util, waves } from './impl.ts';

const { bounceConflicts } = conflict;
const { DEFAULT_CONFIG } = config;
const { parseJsonLoose, validate } = schema;
const { SCHEMAS } = schemas;
const { topoSort } = util;
import { fakeFromSchema } from './helpers.ts';

test('every schema is strict (Codex structured-output compatible) and fakeable', () => {
  const walk = (s: any, path: string) => {
    if (s.anyOf) return s.anyOf.forEach((x: any, i: number) => walk(x, `${path}|${i}`));
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, `${path} additionalProperties`);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${path} required`);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`);
    }
    if (s.type === 'array') walk(s.items, `${path}[]`);
  };
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    walk(schema, name);
    assert.deepEqual(validate(schema, fakeFromSchema(schema)), [], name);
  }
});

test('validator reports precise paths', () => {
  const errors = validate(SCHEMAS.Review, { status: 'maybe', summary: 1, findings: [{}], acceptance: [], extra: true });
  assert.ok(errors.includes('$.status: must be one of "approved", "changes_required"'));
  assert.ok(errors.includes('$.summary: expected string, got integer'));
  assert.ok(errors.includes('$.findings[0].severity: required'));
  assert.ok(errors.includes('$.extra: unexpected property'));
});

test('parseJsonLoose tolerates fences and prose', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Here you go: {"a":2} done'), { a: 2 });
});

test('bounceConflicts escalates non-minor conflicts regardless of host verdict', () => {
  const data: any = {
    questions: [],
    conflicts: [
      { id: 'C1', topic: 'Auth', category: 'security', claude_position: 'a', codex_position: 'b', resolution: 'a', status: 'resolved', options: [] },
      { id: 'C2', topic: 'Loop style', category: 'implementation', claude_position: 'a', codex_position: 'b', resolution: 'a', status: 'resolved', options: [] },
      { id: 'C3', topic: 'Both same', category: 'equivalent', claude_position: 'a', codex_position: 'a', resolution: null, status: 'consensus', options: [] },
      { id: 'C4', topic: 'Perf', category: 'performance', claude_position: 'a', codex_position: 'b', resolution: null, status: 'needs_user', options: [] },
    ],
  };
  assert.deepEqual(bounceConflicts(DEFAULT_CONFIG, data), ['C1', 'C4']);
  assert.deepEqual(data.questions.map((q: any) => q.id), ['D-C1', 'D-C4']);
  assert.deepEqual(data.questions[0].options.map((o: any) => o.key), ['claude', 'codex']);
  assert.equal(data.questions[0].suggested, null, 'host gets no default on escalated conflicts');
});

test('topoSort orders dependencies and rejects cycles', () => {
  const ids = topoSort([
    { id: 'b', depends_on: ['a'] },
    { id: 'a', depends_on: [] },
  ]).map((x) => x.id);
  assert.deepEqual(ids, ['a', 'b']);
  assert.throws(() => topoSort([{ id: 'a', depends_on: ['b'] }, { id: 'b', depends_on: ['a'] }]), /cycle/);
});

test('per-role model/effort overrides fall back to agent defaults', async () => {
  const { resolveAgent } = config;
  const cfg = { model: 'm', effort: 'high', roles: { scanner: { effort: 'medium' }, reviewer: { model: 'm2' } } };
  assert.deepEqual(resolveAgent(cfg, 'scanner'), { model: 'm', effort: 'medium' });
  assert.deepEqual(resolveAgent(cfg, 'reviewer'), { model: 'm2', effort: 'high' });
  assert.deepEqual(resolveAgent(cfg, 'planner'), { model: 'm', effort: 'high' });
});

test('exec returns when the child exits even if a grandchild still holds stdout', async () => {
  const started = Date.now();
  const res = await util.exec('/bin/sh', ['-c', 'sleep 30 & echo done'], { cwd: process.cwd() });
  assert.equal(res.code, 0);
  assert.match(res.stdout, /done/);
  assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started}ms`);
});

test('exec timeout kills the whole process tree', async () => {
  const started = Date.now();
  const res = await util.exec('/bin/sh', ['-c', 'sleep 30 & sleep 30'], { cwd: process.cwd(), timeoutMs: 300 });
  assert.equal(res.timedOut, true);
  assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started}ms`);
});

test('disjointScopes is conservative about glob overlap', () => {
  const { disjointScopes } = waves;
  assert.equal(disjointScopes(['src/a/**'], ['src/b/**']), true);
  assert.equal(disjointScopes(['src/**'], ['src/b/x.ts']), false);
  assert.equal(disjointScopes(['src/a/**', 'build.gradle'], ['src/b/**', 'build.gradle']), false);
  assert.equal(disjointScopes(['src/*.ts'], ['test/*.ts']), true);
  assert.equal(disjointScopes([], ['src/b/**']), false, 'empty scope may touch anything');
});

test('planWaves groups independent disjoint tasks, respecting deps, capacity and solo tasks', () => {
  const { planWaves } = waves;
  const t = (id: string, scope: string[], deps: string[] = []) => ({ id, title: id, description: '', depends_on: deps, files_in_scope: scope, acceptance: [], test_command: null });
  const ids = (w: any[][]) => w.map((x) => x.map((y) => y.id));
  const tasks = [t('T1', ['a/**']), t('T2', ['b/**']), t('T3', ['c/**'], ['T1']), t('T4', ['a/x.ts']), t('T5', ['d/**'])];
  assert.deepEqual(ids(planWaves(tasks, 3)), [['T1', 'T2', 'T5'], ['T3', 'T4']]);
  assert.deepEqual(ids(planWaves(tasks, 2)), [['T1', 'T2'], ['T3', 'T4'], ['T5']]);
  assert.deepEqual(ids(planWaves(tasks, 1)), [['T1'], ['T2'], ['T3'], ['T4'], ['T5']]);
  assert.deepEqual(ids(planWaves(tasks, 3, (x) => x.id === 'T1')), [['T1'], ['T2', 'T3', 'T4'], ['T5']]);
});
