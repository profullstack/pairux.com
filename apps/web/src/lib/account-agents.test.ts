import { describe, expect, it, vi } from 'vitest';
import { agentIdFromKey, keyMatches, mintAgentKey, registerAgentSchema } from './account-agents';

vi.mock('@/lib/supabase/service', () => ({ serviceClient: () => ({}) }));

describe('agent keys', () => {
  const id = '3f2b8c1e-9a4d-4e6f-8b7a-0c1d2e3f4a5b';

  it('names its agent and matches only itself', () => {
    const minted = mintAgentKey(id);
    expect(minted.key.startsWith('pux_ag_3f2b8c1e9a4d4e6f8b7a0c1d2e3f4a5b_')).toBe(true);
    expect(agentIdFromKey(minted.key)).toBe(id);
    expect(keyMatches(minted.key, minted.hash)).toBe(true);
    expect(keyMatches(mintAgentKey(id).key, minted.hash)).toBe(false);
    // Only a short prefix is kept for display; the hash is not the key.
    expect(minted.key.startsWith(minted.prefix)).toBe(true);
    expect(minted.hash).not.toContain(minted.key.slice(-10));
  });

  it('rejects anything that is not an agent key', () => {
    expect(agentIdFromKey('pux_at_whatever')).toBeNull();
    expect(agentIdFromKey('pux_ag_short_x')).toBeNull();
    expect(keyMatches('pux_ag_x', 'abcd')).toBe(false);
  });

  it('validates registrations', () => {
    expect(registerAgentSchema.parse({ name: 'riotcoder', handle: 'RiotCoder' }).handle).toBe(
      'riotcoder'
    );
    expect(() => registerAgentSchema.parse({ name: 'x', handle: 'riotcoder' })).toThrow();
    expect(() => registerAgentSchema.parse({ name: 'ok', handle: 'bad handle' })).toThrow();
  });
});
