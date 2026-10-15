import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';

/**
 * Exchange a PKCE `?code=` for a session AND make sure the session cookies are
 * written before the caller builds its response.
 *
 * auth-js (2.91) emits SIGNED_IN for a code exchange from a setTimeout, and
 * @supabase/ssr (0.5) writes cookies only from that event. In a route handler
 * or middleware the response is long gone by then, so the exchange succeeded
 * at GoTrue while the browser never got a session cookie: a new user clicking
 * the confirmation email ended up signed out. setSession emits SIGNED_IN
 * synchronously (awaited), which flushes every pending cookie write — the
 * session, and the removal of the spent code verifier.
 */
export async function exchangeCodeAndPersist(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  code: string
): Promise<{ session: Session | null; error: AuthError | null }> {
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return { session: null, error };

  const { error: persistError } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  return { session: data.session, error: persistError };
}
