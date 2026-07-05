import type { ZodType } from 'zod';
import { StructuredOutputError } from './errors.js';
import { parseStructured } from './parse.js';

export interface Prompt {
  system: string;
  user: string;
}

/** A minimal chat completion: text in, text out. Every provider reduces to this. */
export type CompleteFn = (prompt: Prompt) => Promise<string>;

/**
 * Run a prompt and validate the reply against `schema`.
 *
 * Implements the PRD's contract: malformed output triggers exactly one
 * auto-repair retry (re-asking for JSON only); a second failure rethrows the
 * {@link StructuredOutputError} so the caller can fall back to manual mode.
 */
export async function completeStructured<T>(
  complete: CompleteFn,
  prompt: Prompt,
  schema: ZodType<T>
): Promise<T> {
  const first = await complete(prompt);
  try {
    return parseStructured(first, schema);
  } catch (error) {
    if (!(error instanceof StructuredOutputError)) {
      throw error;
    }
    const repaired = await complete({
      system: prompt.system,
      user: `${prompt.user}\n\nYour previous reply could not be parsed. Reply again with ONLY the JSON value — no prose, no explanation, no code fences.`,
    });
    return parseStructured(repaired, schema);
  }
}
