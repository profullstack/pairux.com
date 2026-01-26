/* eslint-disable @typescript-eslint/no-deprecated */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import type { Database } from '@pairux/shared-types';
import type { User } from '@supabase/supabase-js';

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

// Store bearer token for the current request context
let currentBearerToken: string | null = null;

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
  currentBearerToken = await getBearerToken();

  if (currentBearerToken) {
    // Desktop app: create client with Bearer token
    // Note: We store the token and use it in getAuthenticatedUser()
    const supabase = createSupabaseClient<Database>(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${currentBearerToken}`,
        },
      },
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

/**
 * Get the authenticated user from the Supabase client.
 * Handles both cookie-based auth (web) and Bearer token auth (desktop app).
 */
export async function getAuthenticatedUser(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ user: User | null; error: Error | null }> {
  // If we have a Bearer token, use it directly with getUser()
  const bearerToken = currentBearerToken ?? (await getBearerToken());

  if (bearerToken) {
    const { data, error } = await supabase.auth.getUser(bearerToken);
    return { user: data.user, error };
  }

  // Cookie-based auth: use getUser() without token
  const { data, error } = await supabase.auth.getUser();
  return { user: data.user, error };
}
