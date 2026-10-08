// Steady feedback while a run advances: a progress note on every step and a heartbeat line while one runs,
// so neither the orchestrator session nor the user is left staring at silence.

import { join } from 'node:path';
import { oneLine } from './activity.ts';
import { readLiveStatus } from './live.ts';
import type { AgentName } from './schemas.ts';
import { exists, fmtMs, readJson } from './util.ts';

const AGENTS: AgentName[] = ['claude', 'codex'];

/** `step 12 · F1 1/2 · T003 3/7 · 1h04m elapsed` — the parts that are known at this point of the run. */
export function progressNote(dir: string, stepId: string, stepNumber: number, createdAt: string, now = Date.now()): string {
  const parts = [`step ${stepNumber}`];
  const [feature, task] = stepId.split('/');
  const decomposition = join(dir, 'decomposition.json');
  if (/^F\d+$/.test(feature) && exists(decomposition)) {
    const ids = readJson<{ features: { id: string }[] }>(decomposition).features.map((f) => f.id);
    if (ids.includes(feature)) parts.push(`${feature} ${ids.indexOf(feature) + 1}/${ids.length}`);
  }
  const tasksFile = join(dir, 'features', feature ?? '', 'tasks.json');
  if (/^T\d+/.test(task ?? '') && exists(tasksFile)) {
    const ids = readJson<{ tasks: { id: string }[] }>(tasksFile).tasks.map((t) => t.id);
    const i = ids.indexOf(task.replace(/-rerun$/, ''));
    if (i >= 0) parts.push(`${task} ${i + 1}/${ids.length}`);
  }
  parts.push(`${fmtElapsed(now - Date.parse(createdAt))} elapsed`);
  return parts.join(' · ');
}

const fmtElapsed = (ms: number) => (ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)}h${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}m` : fmtMs(ms));

/**
 * `⏱ F1/research 4m10s · claude: 📄 read NavHost.kt (37 ev) · codex: $ rg --files (22 ev)`, plus a stall warning
 * (once per call) for any call that has been silent longer than `stallMs`.
 */
export function heartbeatLine(dir: string, stepId: string, startedAt: number, stallMs: number, warned: Set<string>, now = Date.now()): string {
  const parts = [`⏱ ${stepId} ${fmtMs(now - startedAt)}`];
  const warnings: string[] = [];
  for (const agent of AGENTS) {
    for (const [label, c] of Object.entries(readLiveStatus(dir, agent).calls)) {
      parts.push(`${agent}: ${oneLine(c.last, 80)} (${c.events} ev)`);
      const silent = now - Date.parse(c.last_at);
      if (silent >= stallMs && !warned.has(label)) {
        warned.add(label);
        warnings.push(`⚠ ${agent} has been silent for ${fmtMs(silent)} on ${c.step} (the ${c.role} timeout still applies)`);
      }
    }
  }
  return [parts.join(' · '), ...warnings].join('\n');
}

/** Prints a heartbeat every `seconds` until the returned stop function is called. */
export function startHeartbeat(o: { dir: string; stepId: string; seconds: number; stallMinutes: number; print: (line: string) => void; log: (line: string) => void }): () => void {
  if (o.seconds <= 0) return () => {};
  const started = Date.now();
  const warned = new Set<string>();
  const timer = setInterval(() => {
    const line = heartbeatLine(o.dir, o.stepId, started, o.stallMinutes * 60_000, warned);
    o.print(line);
    o.log(line);
  }, o.seconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
