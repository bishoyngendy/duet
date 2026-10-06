// Minimal JSON-Schema builders + validator. Every object is "strict" (all properties required,
// no extras) because Codex --output-schema requires it; optional values are expressed as nullable.

export type Schema = { [k: string]: any };

const d = (description?: string) => (description ? { description } : {});

export const str = (description?: string): Schema => ({ type: 'string', ...d(description) });
export const nstr = (description?: string): Schema => ({ type: ['string', 'null'], ...d(description) });
export const int = (description?: string): Schema => ({ type: 'integer', ...d(description) });
export const nint = (description?: string): Schema => ({ type: ['integer', 'null'], ...d(description) });
export const num = (description?: string): Schema => ({ type: 'number', ...d(description) });
export const bool = (description?: string): Schema => ({ type: 'boolean', ...d(description) });
export const arr = (items: Schema, description?: string): Schema => ({ type: 'array', items, ...d(description) });
export const strs = (description?: string): Schema => arr(str(), description);
export const enm = (values: readonly string[], description?: string): Schema => ({
  type: 'string',
  enum: [...values],
  ...d(description),
});
export const nenm = (values: readonly string[], description?: string): Schema => ({
  type: ['string', 'null'],
  enum: [...values, null],
  ...d(description),
});
export const obj = (properties: Record<string, Schema>, description?: string): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
  ...d(description),
});

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

export function validate(schema: Schema, value: unknown, path = '$'): string[] {
  if (schema.anyOf) {
    const results = (schema.anyOf as Schema[]).map((s) => validate(s, value, path));
    return results.some((r) => r.length === 0) ? [] : results.sort((a, b) => a.length - b.length)[0];
  }
  const errors: string[] = [];
  const types: string[] = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const actual = typeOf(value);
  if (types.length && !types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
    return [`${path}: expected ${types.join('|')}, got ${actual}`];
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((e: unknown) => JSON.stringify(e)).join(', ')}`);
  }
  if (actual === 'array' && schema.items) {
    (value as unknown[]).forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  }
  if (actual === 'object' && schema.properties) {
    const v = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in v)) errors.push(`${path}.${key}: required`);
    }
    for (const [key, val] of Object.entries(v)) {
      const sub = schema.properties[key];
      if (sub) errors.push(...validate(sub, val, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unexpected property`);
    }
  }
  return errors;
}

/** Parse model text output into JSON, tolerating ```json fences and leading prose. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('Output is not JSON');
}
