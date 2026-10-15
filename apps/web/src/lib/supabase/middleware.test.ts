import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const exchangeCodeForSession = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());
const setSession = vi.hoisted(() => vi.fn());

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { exchangeCodeForSession, getUser, setSession },
  }),
}));

import { isAuthRouteHandler, updateSession } from './middleware';

describe('updateSession code exchange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: 'at', refresh_token: 'rt' } },
      error: null,
    });
    setSession.mockResolvedValue({ data: {}, error: null });
    getUser.mockResolvedValue({ data: { user: null } });
  });

  // Regression: the confirmation email lands on /auth/callback?code=…; the
  // middleware used to exchange the code itself and redirect to the bare
  // /auth/callback, which answered /login?error=missing_code.
  it('leaves ?code= on /auth/callback for the route handler', async () => {
    const response = await updateSession(
      new NextRequest('http://localhost/auth/callback?code=abc&next=/dashboard'),
      new Headers()
    );

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBeNull();
  });

  it('still exchanges a code that lands on a page', async () => {
    const response = await updateSession(
      new NextRequest('http://localhost/reset-password?code=abc'),
      new Headers()
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/reset-password');
    expect(location.searchParams.get('code')).toBeNull();
  });

  it('treats every /auth/* path as a route handler', () => {
    expect(isAuthRouteHandler('/auth/callback')).toBe(true);
    expect(isAuthRouteHandler('/auth/reset-password')).toBe(true);
    expect(isAuthRouteHandler('/authors')).toBe(false);
    expect(isAuthRouteHandler('/reset-password')).toBe(false);
  });
});
