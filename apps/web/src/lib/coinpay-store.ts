import type { SupabaseClient } from '@supabase/supabase-js';
import type { CoinpayStore, IdentityRow } from './coinpay-signin';

/** public.coinpay_identities through the service role (RLS on, no policies). */
export function supabaseCoinpayStore(sb: SupabaseClient): CoinpayStore {
  const cols = 'user_id, coinpay_sub, coinpay_email, created_via';
  const table = () => sb.from('coinpay_identities');
  return {
    async identityBySub(sub) {
      const r = await table().select(cols).eq('coinpay_sub', sub).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return (r.data as IdentityRow | null) ?? null;
    },
    async identityByUser(userId) {
      const r = await table().select(cols).eq('user_id', userId).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return (r.data as IdentityRow | null) ?? null;
    },
    async link(row) {
      const r = await table().insert({ ...row, last_login_at: new Date().toISOString() });
      if (r.error) {
        if (r.error.code === '23505') return 'conflict';
        throw new Error(r.error.message);
      }
      return 'ok';
    },
    async unlink(userId) {
      const r = await table().delete().eq('user_id', userId);
      if (r.error) throw new Error(r.error.message);
    },
    async touch(sub) {
      await table().update({ last_login_at: new Date().toISOString() }).eq('coinpay_sub', sub);
    },
    async createUser({ email, name, contactEmail }) {
      const [first, ...rest] = (name ?? '').split(/\s+/).filter(Boolean);
      const r = await sb.auth.admin.createUser({
        email,
        // The placeholder is ours and undeliverable; confirming it only lets the
        // server mint a session for it. Email-gated features check the domain
        // (isPlaceholderEmail) and treat it as unverified.
        email_confirm: true,
        user_metadata: {
          display_name: name ?? 'CoinPay user',
          ...(first ? { first_name: first } : {}),
          ...(rest.length ? { last_name: rest.join(' ') } : {}),
          signup_via: 'coinpay',
          // Unverified contact info from CoinPay. Never an identity.
          ...(contactEmail ? { coinpay_contact_email: contactEmail } : {}),
        },
        app_metadata: { signup_via: 'coinpay' },
      });
      if (r.error) throw new Error(r.error.message);
      return r.data.user.id;
    },
    async deleteUser(userId) {
      await sb.auth.admin.deleteUser(userId);
    },
  };
}

/**
 * A magic-link token hash for the user's OWN auth email, minted server side
 * (nothing is emailed). The callback redeems it with verifyOtp on the cookie
 * client, which writes the normal Supabase session cookies. Refuses an account
 * whose email is not confirmed: redeeming the link would confirm it.
 */
export async function mintMagicLinkHash(
  sb: SupabaseClient,
  userId: string
): Promise<
  { ok: true; tokenHash: string } | { ok: false; code: 'no_account' | 'unconfirmed' | 'session' }
> {
  const u = await sb.auth.admin.getUserById(userId);
  const user = u.data.user;
  if (u.error || !user?.email) return { ok: false, code: 'no_account' };
  if (!user.email_confirmed_at) return { ok: false, code: 'unconfirmed' };
  const link = await sb.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const tokenHash = link.data.properties?.hashed_token;
  if (link.error || !tokenHash) return { ok: false, code: 'session' };
  return { ok: true, tokenHash };
}
