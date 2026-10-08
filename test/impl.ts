// Tests run against the TypeScript sources by default, or against the built plugin engine
// (plain .mjs) when DUETTO_TEST_BUILT=1 — the same suite verifies what users actually install.
const built = Boolean(process.env.DUETTO_TEST_BUILT);
const load = (m: string) => import(built ? `../plugins/duetto/skills/duetto/engine/src/${m}.mjs` : `../src/${m}.ts`);

export const config = await load('config');
export const engine = await load('engine');
export const state = await load('state');
export const util = await load('util');
export const schema = await load('schema');
export const schemas = await load('schemas');
export const conflict = await load('conflict');
export const waves = await load('waves');
export const activity = await load('activity');
export const live = await load('live');
export const panes = await load('panes');
export const watchMod = await load('watch');
export const progress = await load('progress');
export const IMPL = built ? 'built' : 'source';
