/* eslint-disable @typescript-eslint/no-deprecated */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import type { Database } from '@pairux/shared-types';

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
  const headerStore = await headers();
  const authHeader = headerStore.get('authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    // Desktop app: use token-based auth
    return createSupabaseClient<Database>(url, key, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
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
