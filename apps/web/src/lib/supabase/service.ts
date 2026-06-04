import { createClient } from '@supabase/supabase-js';

let cached: ReturnType<typeof createClient> | null = null;

export function serviceClient() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  cached = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return cached;
}
