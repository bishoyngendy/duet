import type { Task } from './schemas.ts';

/** Literal part of a glob before its first wildcard: two globs can only match a common file if one prefix extends the other. */
const literalPrefix = (glob: string) => glob.split(/[*?[{]/)[0];

/** Conservative: true only when no file can match a glob in both lists. An empty scope can touch anything. */
export function disjointScopes(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  return a.every((x) =>
    b.every((y) => {
      const [px, py] = [literalPrefix(x), literalPrefix(y)];
      return !px.startsWith(py) && !py.startsWith(px);
    }),
  );
}

/**
 * Group topologically sorted tasks into waves that can be implemented concurrently: each task goes into the earliest
 * wave after all of its dependencies whose members it can't collide with. `solo` tasks always get a wave to themselves.
 */
export function planWaves(tasks: Task[], max: number, solo: (t: Task) => boolean = () => false): Task[][] {
  const waves: Task[][] = [];
  const waveOf = new Map<string, number>();
  for (const t of tasks) {
    const earliest = Math.max(-1, ...t.depends_on.map((d) => waveOf.get(d)!)) + 1;
    let w = waves.findIndex(
      (wave, i) => i >= earliest && !solo(t) && wave.length < max && !wave.some(solo) && wave.every((o) => disjointScopes(o.files_in_scope, t.files_in_scope)),
    );
    if (w === -1) w = waves.push([]) - 1;
    waves[w].push(t);
    waveOf.set(t.id, w);
  }
  return waves;
}
