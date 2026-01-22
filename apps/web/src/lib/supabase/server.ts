/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-deprecated */
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@pairux/shared-types';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  );
}
