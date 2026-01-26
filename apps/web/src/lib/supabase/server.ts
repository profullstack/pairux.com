/* eslint-disable @typescript-eslint/no-deprecated */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import type { Database } from '@pairux/shared-types';

/**
 * Extract Bearer token from Authorization header if present.
 */
export async function getBearerToken(): Promise<string | null> {
  const headerStore = await headers();
  const authHeader = headerStore.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

/**
 * Create a Supabase client for server-side use.
 * Supports both cookie-based auth (web browser) and Bearer token auth (desktop app).
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  // Check for Bearer token in Authorization header (desktop app)
  const token = await getBearerToken();

  if (token) {
    // Desktop app: create client and set the session with the access token
    const supabase = createSupabaseClient<Database>(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Set the auth session using the access token
    // This allows getUser() to work correctly
    await supabase.auth.setSession({
      access_token: token,
      refresh_token: '', // We don't have refresh token in header, but it's required
    });

    return supabase;
  }

  // Web browser: use cookie-based auth
  const cookieStore = await cookies();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            if (options) {
              cookieStore.set({ name, value, ...options });
            } else {
              cookieStore.set(name, value);
            }
          });
        } catch {
          // Called from Server Component - middleware handles this
        }
      },
    },
  });
}
