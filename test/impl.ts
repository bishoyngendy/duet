// Tests run against the TypeScript sources by default, or against the built plugin engine
// (plain .mjs) when DUET_TEST_BUILT=1 — the same suite verifies what users actually install.
const built = Boolean(process.env.DUET_TEST_BUILT);
const load = (m: string) => import(built ? `../plugins/duet/skills/duet/engine/src/${m}.mjs` : `../src/${m}.ts`);

export const config = await load('config');
export const engine = await load('engine');
export const state = await load('state');
export const util = await load('util');
export const schema = await load('schema');
export const schemas = await load('schemas');
export const conflict = await load('conflict');
export const waves = await load('waves');
export const IMPL = built ? 'built' : 'source';
