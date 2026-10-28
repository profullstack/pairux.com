import { NextResponse } from 'next/server';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import {
  base64ToBytes,
  clampUnlockTtlSeconds,
  isSealRecord,
  isSealedValue,
  openPrivateKey,
  sealToPublicKey,
  verifyDataKey,
  wipe,
} from '@/lib/sealed/crypto';
import { unlockOwner } from '@/lib/sealed/unlockStore';
import { loadSeal } from '@/lib/sealed/vault';

/**
 * POST /api/keys/setup { seal, dek, ttl_seconds?, reset? }
 * Stores the seal the browser built from the passphrase, unlocks, and seals any
 * legacy plaintext YouTube refresh token in the same request.
 */
export async function POST(request: Request) {
  const { user } = await getAuthenticatedUser(await createClient());
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    seal?: unknown;
    dek?: string;
    ttl_seconds?: number;
    reset?: boolean;
  };
  if (!isSealRecord(body.seal) || typeof body.dek !== 'string')
    return NextResponse.json({ error: 'invalid seal' }, { status: 400 });
  const dek = base64ToBytes(body.dek);
  try {
    if (!(await verifyDataKey(dek, body.seal, user.id)))
      return NextResponse.json({ error: 'seal does not match the key' }, { status: 400 });
    if ((await loadSeal(user.id)) && body.reset !== true) {
      return NextResponse.json({ error: 'a key passphrase is already set' }, { status: 409 });
    }
    const sb = serviceClient();
    await sb
      .from('user_key_seals' as never)
      .upsert({ user_id: user.id, seal: body.seal, updated_at: new Date().toISOString() } as never);

    // One-shot migration: a plaintext refresh token is sealed now, or dropped
    // after a reset (a token sealed to the old key can never open again).
    const { data: row } = await sb
      .from('youtube_credentials')
      .select('refresh_token')
      .eq('user_id', user.id)
      .maybeSingle();
    const token = (row as { refresh_token?: string } | null)?.refresh_token;
    if (token && !isSealedValue(token)) {
      await sb
        .from('youtube_credentials')
        .update({
          refresh_token: await sealToPublicKey(
            body.seal.public_key,
            token,
            user.id,
            'youtube_refresh_token'
          ),
          updated_at: new Date().toISOString(),
        } as never)
        .eq('user_id', user.id);
    }

    unlockOwner(
      user.id,
      await openPrivateKey(dek, body.seal, user.id),
      clampUnlockTtlSeconds(body.ttl_seconds)
    );
    return NextResponse.json({ data: { ok: true } });
  } finally {
    wipe(dek);
  }
}
