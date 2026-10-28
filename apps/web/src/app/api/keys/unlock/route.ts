import { NextResponse } from 'next/server';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { base64ToBytes, clampUnlockTtlSeconds, openPrivateKey, wipe } from '@/lib/sealed/crypto';
import { unlockOwner } from '@/lib/sealed/unlockStore';
import { loadSeal } from '@/lib/sealed/vault';

/** POST /api/keys/unlock { dek, ttl_seconds? }: the data key, never the passphrase. Memory only. */
export async function POST(request: Request) {
  const { user } = await getAuthenticatedUser(await createClient());
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { dek?: string; ttl_seconds?: number };
  const seal = await loadSeal(user.id);
  if (!seal) return NextResponse.json({ error: 'no key passphrase set up' }, { status: 409 });
  if (typeof body.dek !== 'string')
    return NextResponse.json({ error: 'dek required' }, { status: 400 });
  const dek = base64ToBytes(body.dek);
  try {
    const key = await openPrivateKey(dek, seal, user.id);
    const { expiresAt } = unlockOwner(user.id, key, clampUnlockTtlSeconds(body.ttl_seconds));
    return NextResponse.json({ data: { ok: true, expiresAt: new Date(expiresAt).toISOString() } });
  } catch {
    return NextResponse.json({ error: 'wrong key' }, { status: 403 });
  } finally {
    wipe(dek);
  }
}
