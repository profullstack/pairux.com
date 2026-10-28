import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script without type declarations
import { chunks, mentions } from './agent-runner.mjs';

describe('agent-runner', () => {
  it('answers only when mentioned by @handle or "name,"', () => {
    expect(mentions('hey @RiotCoder what did she say?', 'riotcoder', 'riotcoder')).toBe(true);
    expect(mentions('riotcoder, status?', 'riotcoder', 'riotcoder')).toBe(true);
    expect(mentions('riotcoder is great', 'riotcoder', 'riotcoder')).toBe(false);
  });
  it('splits long replies under the 500-character chat limit', () => {
    const parts = (chunks as (text: string) => string[])('One sentence here. '.repeat(80));
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(480);
    expect(parts.join(' ').replace(/\s+/g, ' ').trim()).toBe(
      'One sentence here. '.repeat(80).trim()
    );
  });
});
