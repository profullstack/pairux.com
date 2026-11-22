/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { C0MPUTE_DASHBOARD_URL, c0mputeConfig } from '@/lib/c0mpute-live';
import { linksForUser } from '@/lib/c0mpute-live-store';

export const dynamic = 'force-dynamic';

/**
 * The signed-in user's c0mpute Live state, for the Settings card and the
 * dashboard's restream list. No c0mpute credential is kept, so the tier and
 * balance are not known here: c0mpute.com shows them (topUpUrl).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const links = await linksForUser(serviceClient() as unknown as SupabaseClient, user.id);
  const byId = new Map<string, { handle: string; name: string; restreamEnabled: boolean }>();
  if (links.length > 0) {
    const { data } = await (supabase.rpc as any)('list_my_channels');
    for (const c of (data ?? []) as any[]) {
      byId.set(String(c.id), {
        handle: String(c.handle),
        name: String(c.name),
        restreamEnabled: c.restream_enabled === true,
      });
    }
  }

  return Response.json(
    {
      data: {
        configured: c0mputeConfig() !== null,
        connected: links.length > 0,
        accountLabel: links.find((l) => l.account_label)?.account_label ?? null,
        tier: null,
        balanceUsd: null,
        topUpUrl: C0MPUTE_DASHBOARD_URL,
        channels: links.map((l) => {
          const c = byId.get(l.channel_id);
          return {
            channelId: l.channel_id,
            handle: c?.handle ?? null,
            name: c?.name ?? null,
            watchUrl: l.watch_url,
            playbackUrl: l.playback_url,
            restreamEnabled: c?.restreamEnabled ?? null,
          };
        }),
      },
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
