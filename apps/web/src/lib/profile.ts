import { createProfileStore, type ProfileStore } from '@profullstack/profile';
import { serviceClient } from '@/lib/supabase/service';

// The shared @profullstack/profile fields live on public.profiles (keyed by
// the auth user id; RLS lets only the owner read a row). Server-only: it runs
// on the service-role client.
let cached: ProfileStore | null = null;

export function profileStore(): ProfileStore {
  cached ??= createProfileStore(serviceClient(), { table: 'profiles', key: 'id' });
  return cached;
}
