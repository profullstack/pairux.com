import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { completeStructured, type CompleteFn } from './complete.js';
import { StructuredOutputError } from './errors.js';

const schema = z.object({ ok: z.boolean() });

describe('completeStructured', () => {
  it('returns parsed output when the first reply is valid', async () => {
    const complete: CompleteFn = vi.fn(() => Promise.resolve('{"ok": true}'));
    await expect(completeStructured(complete, { system: 's', user: 'u' }, schema)).resolves.toEqual({ ok: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('retries exactly once and succeeds on the repair', async () => {
    const complete = vi
      .fn<CompleteFn>()
      .mockResolvedValueOnce('sorry, here: not json')
      .mockResolvedValueOnce('{"ok": false}');
    const result = await completeStructured(complete, { system: 's', user: 'u' }, schema);
    expect(result).toEqual({ ok: false });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('asks for JSON-only on the repair attempt', async () => {
    const complete = vi.fn<CompleteFn>().mockResolvedValueOnce('nope').mockResolvedValueOnce('{"ok": true}');
    await completeStructured(complete, { system: 's', user: 'u' }, schema);
    const secondCall = complete.mock.calls[1]?.[0];
    expect(secondCall?.user).toContain('ONLY the JSON');
    expect(secondCall?.system).toBe('s');
  });

  it('rethrows StructuredOutputError after a second failure (caller falls back to manual mode)', async () => {
    const complete: CompleteFn = vi.fn(() => Promise.resolve('still not json'));
    await expect(completeStructured(complete, { system: 's', user: 'u' }, schema)).rejects.toBeInstanceOf(
      StructuredOutputError,
    );
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
