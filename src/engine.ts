import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runAgent } from './agents/index.ts';
import { liveCall } from './live.ts';
import { openPanes } from './panes.ts';
import { progressNote, startHeartbeat } from './progress.ts';
import { PHASES, pipeline, type Ctx, type Phase, type Step } from './pipeline.ts';
import { validate } from './schema.ts';
import { SCHEMAS, type Answer, type Feature, type MergedQ } from './schemas.ts';
import { acquireLock, logEvent, saveState } from './state.ts';
import { appendLine, exists, readJson, topoSort, writeJson } from './util.ts';

export function locate(ctx: Ctx): { step: Step | null; done: Step[] } {
  const done: Step[] = [];
  for (const step of pipeline(ctx)) {
    if (step.done()) done.push(step);
    else return { step, done };
  }
  return { step: null, done };
}

function setStatus(ctx: Ctx, status: Ctx['state']['status'], step: Step | null, message: string | null = null) {
  ctx.state.status = status;
  ctx.state.step = step ? { id: step.id, title: step.title, kind: step.kind } : null;
  ctx.state.message = message;
  saveState(ctx.dir, ctx.state);
}

/** Advance until a host step, a user gate, completion or failure. */
export type Until = { phase: Phase; feature?: string };

/**
 * Whether a step lies past `until`: in a later phase of the target feature (or of any feature when none is named),
 * or in a feature after the target. Earlier features are dependencies of the target, so they always run.
 */
export function beyond(ctx: Ctx, step: Step, until: Until): boolean {
  const rank = (p?: Phase) => PHASES.indexOf(p ?? 'scan');
  if (until.feature && step.feature && step.feature !== until.feature) {
    const order = topoSort(readJson<{ features: Feature[] }>(join(ctx.dir, 'decomposition.json')).features).map((f) => f.id);
    return order.indexOf(step.feature) > order.indexOf(until.feature);
  }
  return rank(step.phase) > rank(until.phase);
}

export async function advance(ctx: Ctx, opts: { headless?: boolean; maxSteps?: number; panes?: boolean; until?: Until } = {}): Promise<Ctx['state']['status']> {
  const release = acquireLock(ctx.dir);
  if (opts.until) ctx.state.until = opts.until;
  const until = (ctx.state.until ?? undefined) as Until | undefined;
  let steps = 0;
  let announced = false;
  try {
    for (;;) {
      const { step, done } = locate(ctx);
      if (!step) {
        setStatus(ctx, 'done', null, 'All features complete.');
        logEvent(ctx.dir, { type: 'done' });
        ctx.print('✔ run complete');
        return 'done';
      }
      if (until && beyond(ctx, step, until)) {
        const where = `${until.feature ? `${until.feature} ` : ''}${until.phase}`;
        setStatus(ctx, 'paused', step, `Reached the end of ${where}. Next: ${step.title} — run \`duetto ${step.phase}\` to continue.`);
        logEvent(ctx.dir, { type: 'paused', step: step.id, until });
        ctx.print(`⏹ ${where} complete — next is ${step.title} (duetto ${step.phase})`);
        return 'paused';
      }
      if (opts.maxSteps !== undefined && steps++ >= opts.maxSteps) {
        setStatus(ctx, 'idle', step);
        return 'idle';
      }
      if (step.kind === 'user') {
        setStatus(ctx, 'needs_answers', step);
        logEvent(ctx.dir, { type: 'gate', step: step.id });
        ctx.print(`⏸ ${step.title} — waiting for your answers (duetto next)`);
        return 'needs_answers';
      }
      if (step.kind === 'host' && !opts.headless) {
        setStatus(ctx, 'needs_synthesis', step);
        logEvent(ctx.dir, { type: 'host', step: step.id });
        ctx.print(`⏸ ${step.title} — waiting for the orchestrator session (duetto next)`);
        return 'needs_synthesis';
      }
      setStatus(ctx, 'running', step);
      if (!announced && step.kind !== 'deterministic') {
        announced = true;
        ctx.print(opts.panes ? await openPanes({ dir: ctx.dir, repo: ctx.repo, runId: ctx.state.id, mode: ctx.config.ui.panes }) : 'Watch Claude and Codex live: duetto watch');
      }
      ctx.print(`▶ ${step.title}  [${progressNote(ctx.dir, step.id, done.length + 1, ctx.state.created_at)}]`);
      logEvent(ctx.dir, { type: 'step_start', step: step.id, title: step.title });
      const stopHeartbeat = startHeartbeat({
        dir: ctx.dir,
        stepId: step.id,
        seconds: ctx.config.ui.heartbeat_seconds,
        stallMinutes: ctx.config.ui.stall_minutes,
        print: ctx.print,
        log: (line) => logEvent(ctx.dir, { type: 'heartbeat', step: step.id, line }),
      });
      try {
        if (step.kind === 'host') await runHostHeadless(ctx, step);
        else await step.run!();
      } finally {
        stopHeartbeat();
      }
      if (!step.done()) throw new Error(`Step ${step.id} finished without producing its output`);
      logEvent(ctx.dir, { type: 'step_done', step: step.id });
    }
  } catch (err) {
    const message = (err as Error).message;
    const { step } = safeLocate(ctx);
    setStatus(ctx, 'failed', step, message);
    logEvent(ctx.dir, { type: 'failed', step: step?.id, message });
    ctx.print(`✖ ${message}\n  Fix the cause and run \`duetto run\` again — completed work is kept.`);
    return 'failed';
  } finally {
    release();
  }
}

function safeLocate(ctx: Ctx) {
  try {
    return locate(ctx);
  } catch {
    return { step: null, done: [] };
  }
}

export function hostTaskView(ctx: Ctx, step: Step) {
  const h = step.host!;
  const schemaPath = join(ctx.dir, 'schemas', `${h.schema}.json`);
  writeJson(schemaPath, SCHEMAS[h.schema]);
  const draftPath = join(ctx.dir, 'host', `${step.id.replace(/[^\w.-]+/g, '__')}.json`);
  mkdirSync(dirname(draftPath), { recursive: true });
  return {
    kind: 'host' as const,
    step: step.id,
    title: step.title,
    instructions: h.instructions,
    inputs: h.inputs,
    schema: h.schema,
    schema_path: schemaPath,
    draft_path: draftPath,
  };
}

export function gateView(ctx: Ctx, step: Step) {
  return { kind: 'user' as const, step: step.id, title: step.title, context: step.gate!.context, questions: step.gate!.questions };
}

/** Accept the host's synthesis for the current host step. Throws with validation errors. */
export async function submit(ctx: Ctx, file: string): Promise<Step> {
  const { step } = locate(ctx);
  if (!step || step.kind !== 'host') throw new Error(`No host step is pending (current: ${step?.id ?? 'none'})`);
  let data: any;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot parse ${file}: ${(err as Error).message}`);
  }
  await acceptHostOutput(ctx, step, data);
  logEvent(ctx.dir, { type: 'submit', step: step.id, by: 'host' });
  setStatus(ctx, 'idle', null);
  return step;
}

async function acceptHostOutput(ctx: Ctx, step: Step, data: any) {
  const h = step.host!;
  const errors = validate(SCHEMAS[h.schema], data);
  if (errors.length) throw new Error(`Submission does not match schema ${h.schema}:\n${errors.slice(0, 30).join('\n')}`);
  const final = h.postprocess ? h.postprocess(data) : data;
  writeJson(h.output, final);
  await h.after?.(final);
}

async function runHostHeadless(ctx: Ctx, step: Step) {
  const h = step.host!;
  const agent = ctx.config.synthesizer_fallback;
  const inputs = Object.entries(h.inputs)
    .map(([name, path]) => `<input name="${name}">\n${exists(path) ? readFileSync(path, 'utf8') : '(missing)'}\n</input>`)
    .join('\n\n');
  const prompt = `${h.instructions}\n\n(You are running headless: return the JSON directly instead of submitting a file.)\n\n# Inputs\n${inputs}\n\n# Output\nReturn only the JSON object described by the schema.`;
  ctx.print(`    ${agent} ▸ synthesizer (headless)…`);
  const label = `${step.id.replace(/[^\w.-]+/g, '__')}.host-${agent}`;
  const live = liveCall(ctx.dir, agent, { label, step: step.id, role: 'synthesizer' });
  const started = Date.now();
  const res = await runAgent(ctx.agents[agent], {
    role: 'synthesizer',
    prompt,
    cwd: ctx.repo,
    writable: false,
    schema: SCHEMAS[h.schema],
    rawDir: join(ctx.dir, 'raw'),
    label,
    timeoutMs: ctx.config.timeout_minutes * 60_000,
    onActivity: live.onActivity,
  }).catch((err) => {
    live.end({ ok: false, ms: Date.now() - started, error: (err as Error).message });
    throw err;
  });
  live.end({ ok: true, ms: res.durationMs, costUsd: res.costUsd });
  await acceptHostOutput(ctx, step, res.output);
  logEvent(ctx.dir, { type: 'submit', step: step.id, by: agent, duration_ms: res.durationMs, cost_usd: res.costUsd });
}

/**
 * Record answers for the pending gate. `given` maps question id → option key or free text.
 * With acceptSuggested, unanswered questions take their suggested (consensus) option.
 */
export async function answer(ctx: Ctx, given: Record<string, string>, acceptSuggested = false): Promise<Answer[]> {
  const { step } = locate(ctx);
  if (!step || step.kind !== 'user') throw new Error(`No question gate is pending (current: ${step?.id ?? 'none'})`);
  const qs: MergedQ[] = step.gate!.questions;
  const unknown = Object.keys(given).filter((id) => !qs.some((q) => q.id === id));
  if (unknown.length) throw new Error(`Unknown question id(s): ${unknown.join(', ')}. Pending: ${qs.map((q) => q.id).join(', ')}`);
  const answers: Answer[] = [];
  const missing: string[] = [];
  for (const q of qs) {
    const raw = given[q.id] ?? (acceptSuggested ? (q.suggested ?? undefined) : undefined);
    if (raw === undefined || raw === '') {
      missing.push(q.id);
      continue;
    }
    const opt = q.options.find((o) => o.key.toLowerCase() === raw.toLowerCase());
    answers.push({ id: q.id, question: q.text, choice: opt ? opt.key : raw, label: opt ? `${opt.key}: ${opt.label}` : raw });
  }
  if (missing.length) throw new Error(`Missing answers for: ${missing.join(', ')}`);
  writeJson(step.gate!.output, { questions: qs, answers });
  appendLine(join(ctx.dir, 'decisions.jsonl'), JSON.stringify({ step: step.id, answers }));
  await step.gate!.after?.(answers);
  logEvent(ctx.dir, { type: 'answer', step: step.id, answers: answers.map((a) => ({ id: a.id, choice: a.choice })) });
  setStatus(ctx, 'idle', null);
  return answers;
}

export function costSummary(dir: string) {
  const p = join(dir, 'events.jsonl');
  const totals: Record<string, { calls: number; cost: number; ms: number }> = {};
  if (!exists(p)) return totals;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line) continue;
    const e = JSON.parse(line);
    const who = e.type === 'agent' ? e.agent : e.type === 'submit' && e.by !== 'host' ? e.by : null;
    if (!who) continue;
    const t = (totals[who] ??= { calls: 0, cost: 0, ms: 0 });
    t.calls++;
    t.cost += e.cost_usd ?? 0;
    t.ms += e.duration_ms ?? 0;
  }
  return totals;
}

