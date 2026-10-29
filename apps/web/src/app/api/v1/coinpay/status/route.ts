import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { canDisconnect, coinpayConfig } from '@/lib/coinpay-signin';
import { supabaseCoinpayStore } from '@/lib/coinpay-store';

export const dynamic = 'force-dynamic';

/** The signed-in user's CoinPay link, for the Settings card. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const identity = await supabaseCoinpayStore(
    serviceClient() as unknown as SupabaseClient
  ).identityByUser(user.id);
  return Response.json(
    {
      data: {
        configured: coinpayConfig() !== null,
        connected: identity !== null,
        email: identity?.coinpay_email ?? null,
        canDisconnect: canDisconnect(user.email),
      },
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
