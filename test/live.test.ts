import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { activity, live, panes, watchMod } from './impl.ts';
import { drive, FakeAgent, gitRepo, makeRun, type HostScript } from './helpers.ts';

const { claudeActivity, codexActivity, lineSplitter } = activity;

test('claude stream-json events become activities (main thread only)', () => {
  const cwd = '/repo';
  const assistant = (content: any[], parent: string | null = null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { content } });
  assert.deepEqual(claudeActivity(assistant([{ type: 'thinking', thinking: 'Where is nav?' }, { type: 'text', text: 'Looking.' }]), cwd), [
    { kind: 'thinking', text: 'Where is nav?' },
    { kind: 'message', text: 'Looking.' },
  ]);
  assert.deepEqual(claudeActivity(assistant([{ type: 'tool_use', name: 'Read', input: { file_path: '/repo/src/a.ts' } }]), cwd), [{ kind: 'file', text: 'read src/a.ts' }]);
  assert.deepEqual(claudeActivity(assistant([{ type: 'tool_use', name: 'Bash', input: { command: 'rg NavHost' } }]), cwd), [{ kind: 'command', text: 'rg NavHost' }]);
  assert.equal(claudeActivity(assistant([{ type: 'tool_use', name: 'StructuredOutput', input: {} }]), cwd)[0].kind, 'answer');
  assert.deepEqual(claudeActivity(assistant([{ type: 'text', text: 'sub' }], 'toolu_1'), cwd), [], 'subagent chatter is skipped');
  assert.equal(claudeActivity({ type: 'system', subtype: 'api_retry', attempt: 2, error: 'overloaded' })[0].kind, 'retry');
  assert.deepEqual(claudeActivity({ type: 'result', result: 'x' }), []);
});

test('codex --json events become activities (shapes from a real run)', () => {
  const cwd = '/wt';
  assert.deepEqual(codexActivity({ type: 'item.started', item: { type: 'command_execution', command: `/bin/zsh -lc "pwd; rg --files"`, exit_code: null } }, cwd), [
    { kind: 'command', text: 'pwd; rg --files' },
  ]);
  assert.deepEqual(codexActivity({ type: 'item.completed', item: { type: 'command_execution', command: 'x', exit_code: 0 } }), [], 'success is quiet');
  assert.deepEqual(codexActivity({ type: 'item.completed', item: { type: 'command_execution', command: 'x', exit_code: 2 } }), [{ kind: 'command', text: '↳ exit 2' }]);
  assert.deepEqual(codexActivity({ type: 'item.completed', item: { type: 'reasoning', text: '**Plan** check nav' } }), [{ kind: 'thinking', text: '**Plan** check nav' }]);
  assert.deepEqual(codexActivity({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: '/wt/src/a.ts', kind: 'update' }] } }, cwd), [{ kind: 'file', text: 'update src/a.ts' }]);
  assert.deepEqual(codexActivity({ type: 'item.started', item: { type: 'web_search', query: '' } }), [], 'empty query at start');
  assert.deepEqual(codexActivity({ type: 'item.completed', item: { type: 'web_search', query: '', action: { queries: ['nav3 scenes'] } } }), [{ kind: 'search', text: 'web: nav3 scenes' }]);
  assert.equal(codexActivity({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'cua', tool: 'js', title: 'Open board' } })[0].text, 'cua.js — Open board');
  assert.deepEqual(codexActivity({ type: 'turn.completed', usage: {} }), []);
});

test('codex shell commands are shown without their quoting', () => {
  const { unwrapShell } = activity;
  assert.equal(unwrapShell(`/bin/zsh -lc 'rg --files -g '"'"'!node_modules'"'"''`), `rg --files -g '!node_modules'`);
  assert.equal(unwrapShell(`/bin/zsh -lc "echo \\"hi\\" \\$HOME"`), `echo "hi" $HOME`);
  assert.equal(unwrapShell('git status'), 'git status');
});

test('lineSplitter reassembles lines split across chunks', () => {
  const got: string[] = [];
  const s = lineSplitter((l: string) => got.push(l));
  s.push('{"a":');
  s.push('1}\n{"b":2}\n\n{"c"');
  s.push(':3}');
  s.end();
  assert.deepEqual(got, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('worker calls stream into live/<agent>.log and clear their live status when done', async () => {
  const repo = gitRepo();
  const host: HostScript = (step, base) => (step.host!.schema === 'Decomposition' ? { rationale: 'r', features: [{ id: 'F1', slug: 'x', title: 'X', summary: 's', scope: 's', depends_on: [] }] } : base);
  const ctx = makeRun(repo, { claude: new FakeAgent('claude'), codex: new FakeAgent('codex') }, { depth: 'quick' });
  await drive(ctx, host, () => 'suggested').catch(() => {});
  const log = readFileSync(live.liveLog(ctx.dir, 'claude'), 'utf8');
  assert.match(log, /── scan · scanner · started \d\d:\d\d:\d\d ──/);
  assert.match(log, /💬 claude doing scanner work/);
  assert.match(log, /── scan ✓ done \(\d+s\) ──/);
  assert.deepEqual(live.readLiveStatus(ctx.dir, 'codex').calls, {}, 'no call left in flight');
});

test('live status tags concurrent calls and drives the watch headline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'duetto-live-'));
  const a = live.liveCall(dir, 'claude', { label: 'a', step: 'F1/T001/r1/implement', role: 'implementer' });
  const b = live.liveCall(dir, 'claude', { label: 'b', step: 'F1/T002/r1/implement', role: 'implementer' });
  b.onActivity({ kind: 'command', text: 'npm test' });
  assert.match(readFileSync(live.liveLog(dir, 'claude'), 'utf8'), /\[T002\/r1\] \$ npm test/);
  const headline = watchMod.agentHeadline(dir, 'claude', Date.now());
  assert.match(headline, /implementer F1\/T001\/r1\/implement .* \| .*F1\/T002/);
  a.end({ ok: true, ms: 1000 });
  b.end({ ok: false, ms: 2000, error: 'boom' });
  assert.match(readFileSync(live.liveLog(dir, 'claude'), 'utf8'), /✖ failed: boom/);
  assert.equal(watchMod.agentHeadline(dir, 'claude'), 'claude · idle');
});

test('tailer returns only what was appended since the last read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'duetto-tail-'));
  const f = join(dir, 'x.log');
  const next = watchMod.tailer(f);
  assert.equal(next(), '', 'missing file');
  appendFileSync(f, 'one\n');
  assert.equal(next(), 'one\n');
  assert.equal(next(), '');
  appendFileSync(f, 'two\n');
  assert.equal(next(), 'two\n');
});

test('panes: cmux opens claude right and codex below it, once per run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'duetto-panes-'));
  const calls: string[][] = [];
  const run = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    return { code: 0, stdout: `OK surface:${calls.length + 10} workspace:1`, stderr: '' };
  };
  const env = { CMUX_SURFACE_ID: 'abc', CMUX_BUNDLED_CLI_PATH: '/x/cmux' };
  const o = { dir, repo: '/repo', runId: 'r1', mode: 'auto' as const };
  const msg = await panes.openPanes(o, env, run, (a: string) => `watch ${a}`);
  assert.match(msg, /Opened live Claude and Codex panes \(cmux\)/);
  assert.deepEqual(calls, [
    ['/x/cmux', 'new-split', 'right', '--focus', 'false', '--command', 'watch claude'],
    ['/x/cmux', 'new-split', 'down', '--surface', 'surface:11', '--focus', 'false', '--command', 'watch codex'],
  ]);
  assert.match(await panes.openPanes(o, env, run), /were opened for this run/);
  assert.equal(calls.length, 2, 'resuming does not stack more splits');
});

test('panes: tmux, no multiplexer, off, and failures', async () => {
  const mk = () => mkdtempSync(join(tmpdir(), 'duetto-panes-'));
  const calls: string[][] = [];
  const ok = async (cmd: string, args: string[]) => (calls.push([cmd, ...args]), { code: 0, stdout: '%7\n', stderr: '' });
  await panes.openPanes({ dir: mk(), repo: '/r', runId: 'r', mode: 'auto' }, { TMUX: '/tmp/tmux-1' }, ok, (a: string) => a);
  assert.deepEqual(calls[0], ['tmux', 'split-window', '-h', '-d', '-P', '-F', '#{pane_id}', 'claude']);
  assert.deepEqual(calls[1].slice(-3), ['-t', '%7', 'codex']);
  assert.equal(await panes.openPanes({ dir: mk(), repo: '/r', runId: 'r', mode: 'auto' }, {}, ok), 'Watch Claude and Codex live: duetto watch');
  assert.equal(await panes.openPanes({ dir: mk(), repo: '/r', runId: 'r', mode: 'off' }, { TMUX: 'x' }, ok), 'Watch Claude and Codex live: duetto watch');
  const fail = async () => ({ code: 1, stdout: '', stderr: 'no socket' });
  assert.match(await panes.openPanes({ dir: mk(), repo: '/r', runId: 'r', mode: 'auto' }, { TMUX: 'x' }, fail), /could not open tmux panes: no socket/);
  assert.equal(panes.watchCommand("/my repo's", 'r1', 'codex', '/b/duetto.mjs', '/n/node'), `clear; cd '/my repo'\\''s' && exec '/n/node' '/b/duetto.mjs' watch --agent codex --run 'r1'`);
});
