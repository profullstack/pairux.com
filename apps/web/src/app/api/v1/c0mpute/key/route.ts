import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import {
  C0mputeError,
  c0mputeConfig,
  connectWithCredential,
  looksLikeApiKey,
  outcomeCode,
} from '@/lib/c0mpute-live';
import { supabaseC0mputeLiveStore } from '@/lib/c0mpute-live-store';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

/**
 * POST { key }: the manual fallback to OAuth. The pasted c0mpute API key is
 * checked with /live/me, used to provision the channels, and dropped. It is
 * never stored, logged or echoed back.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });

  const cfg = c0mputeConfig();
  if (!cfg) {
    return Response.json(
      { error: 'c0mpute Live is not available right now.', code: 'unavailable' },
      { status: 503, headers: noStore }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { key?: unknown } | null;
  const key = typeof body?.key === 'string' ? body.key.trim() : '';
  if (!looksLikeApiKey(key)) {
    return Response.json(
      { error: 'That does not look like a c0mpute API key. It starts with c0k_.', code: 'format' },
      { status: 400, headers: noStore }
    );
  }

  try {
    const { account, result } = await connectWithCredential(
      cfg,
      key,
      user.id,
      supabaseC0mputeLiveStore(
        supabase as unknown as SupabaseClient,
        serviceClient() as unknown as SupabaseClient
      )
    );
    return Response.json(
      {
        data: {
          outcome: outcomeCode(result),
          accountLabel: account.accountLabel,
          tier: account.tier,
          balanceUsd: account.balanceUsd,
          usdPerGb: account.usdPerGb,
          topUpUrl: account.topUpUrl,
          channels: result.channels,
        },
      },
      { headers: noStore }
    );
  } catch (err) {
    if (err instanceof C0mputeError && err.code === 'unauthorized') {
      return Response.json(
        {
          error: 'c0mpute did not accept that key. It needs the live:publish scope.',
          code: 'scope',
        },
        { status: 400, headers: noStore }
      );
    }
    // C0mputeError messages carry a status and a code, never the key.
    console.error(
      '[c0mpute-live] key connect failed:',
      err instanceof Error ? err.message : 'error'
    );
    return Response.json(
      { error: 'Could not set up c0mpute Live. Try again in a moment.', code: 'failed' },
      { status: 502, headers: noStore }
    );
  }
}
