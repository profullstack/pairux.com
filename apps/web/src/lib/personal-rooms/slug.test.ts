import { describe, expect, it } from 'vitest';
import { defaultSlugSource, roomUrl, slugBase, slugProblem, uniqueSlug } from './slug';

describe('personal room slugs', () => {
  it('slugifies like the SQL', () => {
    expect(slugBase('Anthony Ettinger')).toBe('anthony-ettinger');
    expect(slugBase('  José  & Co. ')).toBe('jos-co');
    expect(slugBase('a'.repeat(50))).toHaveLength(32);
    expect(slugBase('---')).toBe('');
  });

  it('never uses an email address', () => {
    expect(defaultSlugSource({ display_name: 'bob@example.com' })).toBe('bob');
    expect(defaultSlugSource({ email: 'carol.smith@example.com' })).toBe('carol-smith');
    expect(defaultSlugSource({ username: 'Dave_1', display_name: 'Dave' })).toBe('dave-1');
  });

  it('validates', () => {
    expect(slugProblem('anthony-ettinger')).toBeNull();
    expect(slugProblem('ab')).not.toBeNull();
    expect(slugProblem('-abc')).not.toBeNull();
    expect(slugProblem('a--b')).not.toBeNull();
    expect(slugProblem('Upper')).not.toBeNull();
    expect(slugProblem('settings')).toMatch(/reserved/);
    expect(slugProblem('token')).toMatch(/reserved/);
  });

  it('picks the first free slug, and is stable when re-run (idempotent backfill)', () => {
    const taken = new Set(['sam', 'sam-2']);
    expect(uniqueSlug('sam', (s) => taken.has(s))).toBe('sam-3');
    expect(uniqueSlug('jo', () => false)).toBe('jo-room');
    expect(uniqueSlug('admin', () => false)).toBe('admin-room');
    // Same inputs, same answer.
    expect(uniqueSlug('sam', (s) => taken.has(s))).toBe('sam-3');
  });

  it('builds the public URL', () => {
    expect(roomUrl('anthony-ettinger')).toBe('https://pairux.com/m/anthony-ettinger');
    expect(roomUrl('x-y-z', 'http://localhost:3000/')).toBe('http://localhost:3000/m/x-y-z');
  });
});
