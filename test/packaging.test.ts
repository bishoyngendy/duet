import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { util } from './impl.ts';

const root = join(import.meta.dirname, '..');
const commands: { name: string }[] = JSON.parse(readFileSync(join(root, 'packaging', 'commands.json'), 'utf8'));

test('every command in packaging/commands.json has a plugin skill and a Spec Kit extension command', () => {
  const manifest = readFileSync(join(root, 'speckit', 'duetto', 'extension.yml'), 'utf8');
  for (const c of commands) {
    const skill = readFileSync(join(root, 'plugins', 'duetto', 'skills', `duetto-${c.name}`, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`^---\\nname: duetto-${c.name}\\ndescription: .+\\n---\\n`));
    assert.match(skill, new RegExp(`duetto ${c.name} .*--detach`));
    assert.match(skill, /\.\.\/duetto\/reference\/loop\.md/);
    const cmd = readFileSync(join(root, 'speckit', 'duetto', 'commands', `speckit.duetto.${c.name}.md`), 'utf8');
    assert.match(cmd, /\$ARGUMENTS/);
    assert.match(cmd, new RegExp(`\\.specify/extensions/duetto/scripts/bash/duetto\\.sh ${c.name} `));
    assert.match(cmd, /When `duetto watch --milestones` exits/, 'the shared loop is embedded');
    assert.ok(manifest.includes(`- name: speckit.duetto.${c.name}\n      file: commands/speckit.duetto.${c.name}.md`));
  }
  // Spec Kit's manifest rules: namespaced command names, an id matching the namespace
  for (const m of manifest.matchAll(/- name: (speckit\.[^\s]+)/g)) assert.match(m[1], /^speckit\.duetto\.[a-z0-9-]+$/);
  assert.match(manifest, /^schema_version: "1\.0"\nextension:\n  id: duetto\n/m);
  assert.match(manifest, /hooks:\n  after_tasks:\n    command: speckit\.duetto\.analyze/);
});

test("the Spec Kit extension's script finds the engine from DUETTO_BIN, PATH or a plugin install, and explains when it can't", async () => {
  const script = join(root, 'speckit', 'duetto', 'scripts', 'bash', 'duetto.sh');
  const dir = mkdtempSync(join(tmpdir(), 'duetto-sh-'));
  const fake = join(dir, 'duetto.mjs');
  writeFileSync(fake, 'console.log("engine", process.argv.slice(2).join(" "));\n');
  const run = (env: Record<string, string>) => util.exec('bash', [script, 'plan', '--detach'], { cwd: dir, env: { PATH: '/usr/bin:/bin:' + process.execPath.replace(/\/node$/, ''), HOME: dir, ...env } });
  assert.match((await run({ DUETTO_BIN: fake })).stdout, /^engine plan --detach/);
  const plugin = join(dir, '.claude', 'plugins', 'cache', 'duetto', 'duetto', '0.2.0', 'skills', 'duetto', 'engine', 'bin');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, 'duetto.mjs'), 'console.log("installed plugin");\n');
  assert.match((await run({})).stdout, /installed plugin/);
  const none = await util.exec('bash', [script, 'plan'], { cwd: dir, env: { PATH: '/usr/bin:/bin', HOME: mkdtempSync(join(tmpdir(), 'duetto-home-')) } });
  assert.equal(none.code, 127);
  assert.match(none.stderr, /Duetto engine not found\. Install the duetto plugin/);
});
