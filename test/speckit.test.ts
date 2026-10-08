import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prompt, speckit } from './impl.ts';

const repo = () => mkdtempSync(join(tmpdir(), 'duetto-sk-'));
const put = (root: string, rel: string, content: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), content);
};

test('detect reads .specify/ and its default integration', () => {
  const r = repo();
  assert.deepEqual(speckit.detect(r), { present: false, integration: null });
  put(r, '.specify/integration.json', JSON.stringify({ default_integration: 'claude', installed_integrations: ['claude', 'codex'] }));
  assert.deepEqual(speckit.detect(r), { present: true, integration: 'claude' });
  put(r, '.specify/integration.json', JSON.stringify({ integration: 'codex' }));
  assert.equal(speckit.detect(r).integration, 'codex', 'legacy key');
});

test("agents get Spec Kit's constitution when the project has one", () => {
  const r = repo();
  put(r, '.duetto/constitution.md', 'DUETTO RULES');
  assert.match(prompt.workerPrompt('scanner', r, {}), /DUETTO RULES/);
  put(r, '.specify/memory/constitution.md', 'SPEC KIT PRINCIPLES');
  const p = prompt.workerPrompt('scanner', r, {});
  assert.match(p, /SPEC KIT PRINCIPLES/);
  assert.doesNotMatch(p, /DUETTO RULES/);
});

test('templates resolve through Spec Kit: its script, then overrides, then .specify/templates, then bundled', async () => {
  const r = repo();
  assert.match(await speckit.resolveTemplate(r, 'spec-template'), /^# Feature Specification: \[FEATURE NAME\]/, 'bundled copy');
  put(r, '.specify/templates/spec-template.md', 'PROJECT TEMPLATE');
  assert.equal(await speckit.resolveTemplate(r, 'spec-template'), 'PROJECT TEMPLATE');
  put(r, '.specify/templates/overrides/spec-template.md', 'OVERRIDE');
  assert.equal(await speckit.resolveTemplate(r, 'spec-template'), 'OVERRIDE');
  put(r, '.specify/scripts/bash/resolve-template.sh', '#!/bin/bash\necho "FROM SCRIPT $1"\n');
  chmodSync(join(r, '.specify/scripts/bash/resolve-template.sh'), 0o755);
  assert.equal((await speckit.resolveTemplate(r, 'plan-template')).trim(), 'FROM SCRIPT plan-template');
});

test("feature.json is read and written the way Spec Kit's scripts do (repo-relative), only inside Spec Kit projects", () => {
  const r = repo();
  speckit.writeFeatureDir(r, join(r, 'specs/001-x'));
  assert.equal(speckit.readFeatureDir(r), null, 'no .specify/ → nothing written');
  mkdirSync(join(r, '.specify'));
  speckit.writeFeatureDir(r, join(r, 'specs/001-x'));
  assert.deepEqual(JSON.parse(readFileSync(join(r, '.specify/feature.json'), 'utf8')), { feature_directory: 'specs/001-x' });
  assert.equal(speckit.readFeatureDir(r), 'specs/001-x');
});

test('feature numbers follow Spec Kit: 3+ digit sequence, timestamp dirs ignored', () => {
  const r = repo();
  assert.equal(speckit.nextFeatureNumber(join(r, 'specs')), '001');
  for (const d of ['001-a', '007-b', '20261008-101500-c', 'notes']) mkdirSync(join(r, 'specs', d), { recursive: true });
  assert.equal(speckit.nextFeatureNumber(join(r, 'specs')), '008');
  mkdirSync(join(r, 'specs', '1203-big'));
  assert.equal(speckit.nextFeatureNumber(join(r, 'specs')), '1204');
});
