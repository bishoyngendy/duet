// Live per-agent views. While workers stream, each agent gets a human-readable transcript (live/<agent>.log,
// followed by `duetto watch` and the auto-opened panes) and a status file (live/<agent>.json: what each of its
// in-flight calls is doing right now, read by watch, status and the heartbeat).

import { join } from 'node:path';
import { oneLine, type Activity, type ActivityKind } from './activity.ts';
import type { AgentName } from './schemas.ts';
import { appendLine, exists, fmtMs, readJson, writeJson } from './util.ts';

export type CallStatus = { step: string; role: string; started_at: string; last_at: string; last: string; events: number };
export type LiveStatus = { agent: AgentName; calls: Record<string, CallStatus> };

export const liveDir = (runDir: string) => join(runDir, 'live');
export const liveLog = (runDir: string, agent: AgentName) => join(liveDir(runDir), `${agent}.log`);
const statusPath = (runDir: string, agent: AgentName) => join(liveDir(runDir), `${agent}.json`);

export function readLiveStatus(runDir: string, agent: AgentName): LiveStatus {
  const p = statusPath(runDir, agent);
  try {
    return exists(p) ? readJson<LiveStatus>(p) : { agent, calls: {} };
  } catch {
    return { agent, calls: {} };
  }
}

const ICONS: Record<ActivityKind, string> = { thinking: '💭', message: '💬', command: '$', file: '📄', search: '🔎', tool: '🔧', retry: '⚠', answer: '✅' };
const clock = (d = new Date()) => d.toTimeString().slice(0, 8);
/** `F1/T002/r1/implement` → `T002/r1`: enough to tell concurrent calls apart. */
const shortStep = (step: string) => step.split('/').slice(1, 3).join('/') || step;

export function formatActivity(a: Activity, tag = '', at = new Date()): string {
  const max = a.kind === 'thinking' || a.kind === 'message' ? 400 : 240;
  return `${clock(at)} ${tag ? `[${tag}] ` : ''}${ICONS[a.kind]} ${oneLine(a.text, max)}`;
}

/** Track one worker call in its agent's live files. */
export function liveCall(runDir: string, agent: AgentName, o: { label: string; step: string; role: string }) {
  const log = liveLog(runDir, agent);
  const now = new Date().toISOString();
  const update = (fn: (s: LiveStatus) => void) => {
    const s = readLiveStatus(runDir, agent);
    fn(s);
    writeJson(statusPath(runDir, agent), s);
  };
  const call: CallStatus = { step: o.step, role: o.role, started_at: now, last_at: now, last: 'starting…', events: 0 };
  update((s) => (s.calls[o.label] = call));
  appendLine(log, `\n── ${o.step} · ${o.role} · started ${clock()} ──`);
  return {
    onActivity(a: Activity) {
      call.events++;
      call.last = `${ICONS[a.kind]} ${oneLine(a.text, 120)}`;
      call.last_at = new Date().toISOString();
      // Several calls of the same agent can run at once (parallel task waves): tag their lines.
      const concurrent = Object.keys(readLiveStatus(runDir, agent).calls).length > 1;
      appendLine(log, formatActivity(a, concurrent ? shortStep(o.step) : ''));
      update((s) => (s.calls[o.label] = call));
    },
    end(outcome: { ok: boolean; ms: number; costUsd?: number; error?: string }) {
      const cost = outcome.costUsd ? `, $${outcome.costUsd.toFixed(2)}` : '';
      appendLine(log, `── ${o.step} ${outcome.ok ? '✓ done' : `✖ failed: ${oneLine(outcome.error ?? '', 160)}`} (${fmtMs(outcome.ms)}${cost}) ──`);
      update((s) => delete s.calls[o.label]);
    },
  };
}
