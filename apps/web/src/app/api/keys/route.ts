import { NextResponse } from 'next/server';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { loadSeal } from '@/lib/sealed/vault';
import { unlockStatus } from '@/lib/sealed/unlockStore';

/** GET /api/keys: the caller's seal record (ciphertext + public key) and lock state. */
export async function GET() {
  const { user } = await getAuthenticatedUser(await createClient());
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const seal = await loadSeal(user.id);
  const s = unlockStatus(user.id);
  return NextResponse.json({
    data: {
      userId: user.id,
      seal,
      unlocked: s.unlocked,
      expiresAt: s.expiresAt,
      state: !seal ? 'setup_required' : s.unlocked ? 'unlocked' : 'locked',
    },
  });
}
