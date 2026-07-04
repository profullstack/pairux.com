import type { ZodType } from 'zod';
import { StructuredOutputError } from './errors.js';

/**
 * Pull the first JSON value out of a model reply that may wrap it in prose or a
 * ```json fence. Best-effort: returns the most plausible JSON substring, which
 * `parseStructured` then validates.
 */
export function extractJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const fencedBody = fenced?.[1];
  if (fencedBody !== undefined) {
    return fencedBody.trim();
  }

  const start = raw.search(/[[{]/);
  if (start === -1) {
    return raw.trim();
  }

  const opener = raw[start];
  if (opener === undefined) {
    return raw.trim();
  }

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
    throw new StructuredOutputError(`model output failed schema validation: ${result.error.message}`, raw, {
      cause: result.error,
    });
  }
  return result.data;
}
