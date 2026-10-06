import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readText } from './util.ts';

const PROMPTS = join(import.meta.dirname, '..', 'prompts');
export const promptPath = (name: string) => join(PROMPTS, `${name}.md`);
export const loadPrompt = (name: string) => readFileSync(promptPath(name), 'utf8').trim();

export function constitution(repo: string): string {
  return readText(join(repo, '.orchestra', 'constitution.md'), '(no constitution defined)').trim();
}

/** Inputs are embedded verbatim so both models receive byte-identical context. */
export function workerPrompt(role: string, repo: string, inputs: Record<string, unknown>, extra = ''): string {
  const blocks = Object.entries(inputs)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([name, v]) => `<input name="${name}">\n${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}\n</input>`)
    .join('\n\n');
  return [
    loadPrompt('_worker'),
    loadPrompt(role),
    `# Engineering constitution\n${constitution(repo)}`,
    `# Inputs\n${blocks}`,
    extra && `# Additional instructions\n${extra}`,
    '# Output\nReturn only the JSON object described by the schema.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function hostInstructions(step: string, extra = ''): string {
  return [loadPrompt('host/_common'), loadPrompt(`host/${step}`), extra].filter(Boolean).join('\n\n');
}
