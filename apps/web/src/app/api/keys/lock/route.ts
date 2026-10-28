import { NextResponse } from 'next/server';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { lockOwner } from '@/lib/sealed/unlockStore';

/** POST /api/keys/lock: drop the caller's key from memory. */
export async function POST() {
  const { user } = await getAuthenticatedUser(await createClient());
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  lockOwner(user.id);
  return NextResponse.json({ data: { ok: true } });
}
