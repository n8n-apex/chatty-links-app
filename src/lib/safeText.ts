/**
 * Defensive coercion helpers for backend payloads.
 *
 * The n8n pipelines are not schema-stable: a field typed `string` in our
 * interfaces can arrive as an object, an array, a number or null. Passing a
 * non-string into react-markdown throws (it calls .replace on the input), which
 * takes down the whole tree. These helpers keep rendering total.
 */

const pickString = (obj: Record<string, unknown>): string | null => {
  // Ordered by how the backend usually names the human-readable field.
  for (const key of ['display', 'text', 'value', 'paragraph', 'label', 'title', 'name']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  }
  return null;
};

/** Coerce any backend value into a safe, renderable string. Never throws. */
export const toText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(toText).filter((s) => s.trim() !== '').join('\n');
  }
  if (typeof value === 'object') {
    const picked = pickString(value as Record<string, unknown>);
    if (picked !== null) return picked;
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
};

/** Coerce any backend value into a list of safe strings. Never throws. */
export const toStringList = (value: unknown): string[] => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map(toText).filter((s) => s.trim() !== '');
  }
  const s = toText(value);
  return s.trim() ? [s] : [];
};

/** True when the value produces visible content after coercion. */
export const hasText = (value: unknown): boolean => toText(value).trim() !== '';
