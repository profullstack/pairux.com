import { describe, expect, it } from 'vitest';
import { recordingHref, replayOf, replayPath } from './replay';

describe('replayOf', () => {
  it('keeps no replay for off, missing or unknown settings', () => {
    expect(replayOf('off', 'chan')).toBeNull();
    expect(replayOf(null, 'chan')).toBeNull();
    expect(replayOf('everyone', 'chan')).toBeNull();
  });

  it('publishes on the channel when there is one', () => {
    expect(replayOf('public', 'chan')).toBe('public');
  });

  it('never publishes a replay with no channel to put it on', () => {
    expect(replayOf('public', null)).toBe('private');
  });

  it('keeps a private replay private', () => {
    expect(replayOf('private', 'chan')).toBe('private');
    expect(replayOf('private', null)).toBe('private');
  });
});

describe('recordingHref', () => {
  it('links a public room recording to its live page', () => {
    expect(recordingHref('chovy', { id: 'r1', join_code: 'ABC123' })).toBe('/l/ABC123');
  });

  it('links a meeting replay to its replay page, never a room code', () => {
    const href = recordingHref('profullstack', {
      id: '0b5c9d1e-1111-4222-8333-444455556666',
      join_code: null,
    });
    expect(href).toBe('/c/profullstack/replay/0b5c9d1e-1111-4222-8333-444455556666');
  });

  it('escapes what it puts in the path', () => {
    expect(replayPath('a b', 'x/y')).toBe('/c/a%20b/replay/x%2Fy');
  });
});
