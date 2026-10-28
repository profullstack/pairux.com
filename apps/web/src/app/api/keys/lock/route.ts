import { NextResponse } from 'next/server';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { lockOwner } from '@/lib/sealed/unlockStore';
import { lockAllCopilotKeys } from '@/lib/copilot/keys';

/** POST /api/keys/lock: drop the caller's key from memory (YouTube and every meeting copilot unlock). */
export async function POST() {
  const { user } = await getAuthenticatedUser(await createClient());
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  lockOwner(user.id);
  lockAllCopilotKeys(user.id);
  return NextResponse.json({ data: { ok: true } });
}
