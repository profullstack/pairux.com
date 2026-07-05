import type { ZodType } from 'zod';
import { StructuredOutputError } from './errors.js';

const FENCE = '```';

/** True if `text` is a short run of ASCII letters (a code-fence language tag like "json"). */
function isLanguageTag(text: string): boolean {
  if (text.length === 0 || text.length > 16) {
    return false;
  }
  for (const char of text) {
    const isLetter = (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
    if (!isLetter) {
      return false;
    }
  }
  return true;
}

/** Index of the first `{` or `[` in `raw`, or -1. Linear scan (no regex, no backtracking). */
function firstBracket(raw: string): number {
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '{' || char === '[') {
      return i;
    }
  }
  return -1;
}

/**
 * Pull the first JSON value out of a model reply that may wrap it in prose or a
 * ```json fence. Uses index scans only (no regex) so it cannot backtrack on
 * adversarial input. Best-effort: returns the most plausible JSON substring,
 * which `parseStructured` then validates.
 */
export function extractJson(raw: string): string {
  const fenceStart = raw.indexOf(FENCE);
  if (fenceStart !== -1) {
    const afterOpen = fenceStart + FENCE.length;
    const fenceEnd = raw.indexOf(FENCE, afterOpen);
    if (fenceEnd !== -1) {
      let body = raw.slice(afterOpen, fenceEnd);
      const newline = body.indexOf('\n');
      if (newline !== -1 && isLanguageTag(body.slice(0, newline).trim())) {
        body = body.slice(newline + 1);
      }
      return body.trim();
    }
  }

  const start = firstBracket(raw);
  if (start === -1) {
    return raw.trim();
  }

  const opener = raw[start];
  const closer = opener === '[' ? ']' : '}';
  const end = raw.lastIndexOf(closer);
  if (end > start) {
    return raw.slice(start, end + 1).trim();
  }
  return raw.slice(start).trim();
}

/** Extract + JSON.parse + schema-validate. Throws {@link StructuredOutputError} on any failure. */
export function parseStructured<T>(raw: string, schema: ZodType<T>): T {
  const json = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (cause) {
    throw new StructuredOutputError('model output was not valid JSON', raw, { cause });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StructuredOutputError(
      `model output failed schema validation: ${result.error.message}`,
      raw,
      {
        cause: result.error,
      }
    );
  }
  return result.data;
}
