/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@pairux/shared-types';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
