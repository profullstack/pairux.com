import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { canDisconnect } from '@/lib/coinpay-signin';
import { supabaseCoinpayStore } from '@/lib/coinpay-store';

export const dynamic = 'force-dynamic';

/** POST from Settings (same-origin fetch; the session cookie is SameSite=Lax). */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canDisconnect(user.email)) {
    return Response.json(
      {
        error: 'CoinPay is the only way to sign in to this account, so it cannot be disconnected.',
      },
      { status: 409 }
    );
  }
  await supabaseCoinpayStore(serviceClient() as unknown as SupabaseClient).unlink(user.id);
  return Response.json({ data: { connected: false } });
}
