import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { StructuredOutputError } from './errors.js';
import { extractJson, parseStructured } from './parse.js';

const schema = z.object({ ok: z.boolean() });

describe('extractJson', () => {
  it('unwraps a ```json fence', () => {
    expect(extractJson('```json\n{"ok": true}\n```')).toBe('{"ok": true}');
  });

  it('unwraps a bare ``` fence', () => {
    expect(extractJson('```\n[1, 2]\n```')).toBe('[1, 2]');
  });

  it('slices JSON out of surrounding prose', () => {
    expect(extractJson('Sure! {"ok": true} hope that helps')).toBe('{"ok": true}');
  });

  it('slices an array out of prose', () => {
    expect(extractJson('here you go: [{"a":1}] done')).toBe('[{"a":1}]');
  });

  it('returns trimmed input when no JSON is present', () => {
    expect(extractJson('  no json here  ')).toBe('no json here');
  });
});

describe('parseStructured', () => {
  it('parses and validates', () => {
    expect(parseStructured('{"ok": true}', schema)).toEqual({ ok: true });
  });

  it('throws StructuredOutputError on invalid JSON', () => {
    expect(() => parseStructured('{not json', schema)).toThrow(StructuredOutputError);
  });

  it('throws StructuredOutputError on schema mismatch', () => {
    expect(() => parseStructured('{"ok": "yes"}', schema)).toThrow(StructuredOutputError);
  });

  it('preserves the raw output on the error', () => {
    try {
      parseStructured('garbage', schema);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredOutputError);
      expect((error as StructuredOutputError).raw).toBe('garbage');
    }
  });
});
