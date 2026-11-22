import { describe, expect, it } from 'vitest';
import { defaultRoom, type PersonalRoom } from './rooms';

const r = (id: string, is_default: boolean): PersonalRoom => ({
  id,
  slug: id,
  name: id,
  url: `https://pairux.com/m/${id}`,
  is_default,
  settings: { mode: 'p2p', locked: false },
});

describe('defaultRoom', () => {
  it('prefers the default, then the first, then nothing', () => {
    expect(defaultRoom([r('a', false), r('b', true)])?.id).toBe('b');
    expect(defaultRoom([r('a', false)])?.id).toBe('a');
    expect(defaultRoom([])).toBeNull();
    expect(defaultRoom(undefined)).toBeNull();
  });
});
