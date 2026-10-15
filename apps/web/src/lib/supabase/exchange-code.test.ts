import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { exchangeCodeAndPersist } from './exchange-code';

function client(exchange: unknown, set: unknown = { data: {}, error: null }) {
  const auth = {
    exchangeCodeForSession: vi.fn().mockResolvedValue(exchange),
    setSession: vi.fn().mockResolvedValue(set),
  };
  return { auth, supabase: { auth } as unknown as SupabaseClient };
}

describe('exchangeCodeAndPersist', () => {
  // Regression: the exchange's SIGNED_IN fires from a setTimeout, after the
  // route handler has returned, so @supabase/ssr never wrote the cookies.
  it('re-applies the session so cookies are written before returning', async () => {
    const session = { access_token: 'at', refresh_token: 'rt' };
    const { auth, supabase } = client({ data: { session }, error: null });

    const result = await exchangeCodeAndPersist(supabase, 'code-1');

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('code-1');
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
    expect(result).toEqual({ session, error: null });
  });

  it('returns the exchange error without touching the session', async () => {
    const error = new Error('bad code');
    const { auth, supabase } = client({ data: { session: null }, error });

    const result = await exchangeCodeAndPersist(supabase, 'code-1');

    expect(auth.setSession).not.toHaveBeenCalled();
    expect(result.error).toBe(error);
  });
});
