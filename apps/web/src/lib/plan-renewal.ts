/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { createEmailer } from '@profullstack/emailer';
import { getPlanDef, TERM_DAYS, upgradePath } from './plans';

/**
 * Renewal reminders for paid plans.
 *
 * A CoinPay payment buys one 31-day term and nothing renews on its own, so a
 * paying host who forgets drops back to Free in the middle of a week. The
 * per-minute reminders tick mails them three days before the term ends, one day
 * before, and once just after it ended, each with a one-click renew link.
 *
 * Leads own bands, like meeting reminders: 3d covers 3 days to 1 day left, 1d
 * covers the last day, expired covers the 3 days after. A runner that was down
 * sends the tightest still-true reminder rather than everything it slept
 * through, and the ledger (plan_renewal_reminders) makes each one at most once.
 */

export type RenewalLead = '3d' | '1d' | 'expired';

const DAY_MS = 86_400_000;
const USERS_PER_RUN = 200;

export function dueRenewalLead(expiresAt: Date, now: Date): RenewalLead | null {
  const left = expiresAt.getTime() - now.getTime();
  if (left <= 0) return left > -3 * DAY_MS ? 'expired' : null;
  if (left <= DAY_MS) return '1d';
  if (left <= 3 * DAY_MS) return '3d';
  return null;
}

export function renewalEmail(opts: {
  lead: RenewalLead;
  planName: string;
  priceUsd: number;
  expiresAt: Date;
  renewUrl: string;
  name: string | null;
}): { subject: string; html: string } {
  const date = opts.expiresAt.toUTCString().replace(/:\d\d GMT$/, ' UTC');
  const subject =
    opts.lead === 'expired'
      ? `Your PairUX ${opts.planName} plan has ended`
      : `Your PairUX ${opts.planName} plan ends ${opts.lead === '1d' ? 'tomorrow' : 'in 3 days'}`;
  const lineOne =
    opts.lead === 'expired'
      ? `Your ${opts.planName} plan ended on ${date}. Your rooms are back on the Free limits (2 participants, 20 listeners).`
      : `Your ${opts.planName} plan runs until ${date}. Payments do not renew on their own, so nothing will be charged.`;
  const greeting = opts.name ? `Hi ${opts.name},` : 'Hi,';
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
    <div style="background:#4f46e5;padding:24px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">${subject}</h1>
    </div>
    <div style="padding:32px;text-align:center;">
      <p style="color:#374151;font-size:15px;margin:0 0 16px;">${greeting}</p>
      <p style="color:#374151;font-size:15px;margin:0 0 24px;">${lineOne}</p>
      <a href="${opts.renewUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:600;font-size:15px;">Renew ${opts.planName}: $${String(opts.priceUsd)} for ${String(TERM_DAYS)} days</a>
      <p style="color:#9ca3af;font-size:13px;margin-top:20px;">Pay with USDC, USDT, BTC, ETH, SOL and other coins, or PayPal. Renewing early adds the time on top of what is left.</p>
    </div>
    <div style="background:#f9fafb;padding:18px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">Sent via <a href="https://pairux.com" style="color:#6366f1;text-decoration:none;">PairUX</a> because you have a paid plan.</p>
    </div>
  </div>
</body>
</html>`;
  return { subject, html };
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase environment variables');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export interface RenewalSummary {
  renewalEmails: number;
  renewalSkipped: number;
  renewalErrors: string[];
}

export async function runPlanRenewalReminders(now: Date = new Date()): Promise<RenewalSummary> {
  const summary: RenewalSummary = { renewalEmails: 0, renewalSkipped: 0, renewalErrors: [] };
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    summary.renewalErrors.push('RESEND_API_KEY not configured');
    return summary;
  }
  const db = admin() as any;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com').replace(/\/+$/, '');
  const emailer = createEmailer({
    resendApiKey,
    defaultFrom: process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>',
  }) as { send: (o: unknown) => Promise<unknown> };

  const { data: profiles, error } = await db
    .from('profiles')
    .select('id, display_name, plan, plan_expires_at')
    .neq('plan', 'free')
    .gt('plan_expires_at', new Date(now.getTime() - 3 * DAY_MS).toISOString())
    .lte('plan_expires_at', new Date(now.getTime() + 3 * DAY_MS).toISOString())
    .limit(USERS_PER_RUN);
  if (error) {
    summary.renewalErrors.push(`load profiles: ${String(error.message)}`);
    return summary;
  }

  for (const row of (profiles ?? []) as {
    id: string;
    display_name: string | null;
    plan: string;
    plan_expires_at: string;
  }[]) {
    const plan = getPlanDef(row.plan);
    const expiresAt = new Date(row.plan_expires_at);
    const lead = dueRenewalLead(expiresAt, now);
    if (!plan || !lead) continue;
    try {
      // Claim before sending: two overlapping ticks cannot both mail.
      const { error: claimError } = await db.from('plan_renewal_reminders').insert({
        user_id: row.id,
        expires_at: row.plan_expires_at,
        lead,
      });
      if (claimError) {
        if (claimError.code !== '23505') summary.renewalErrors.push(String(claimError.message));
        summary.renewalSkipped += 1;
        continue;
      }
      const { data: user } = await db.auth.admin.getUserById(row.id);
      const to = user?.user?.email as string | undefined;
      if (!to) {
        summary.renewalSkipped += 1;
        continue;
      }
      const { subject, html } = renewalEmail({
        lead,
        planName: plan.label.replace(/^PairUX /, ''),
        priceUsd: plan.priceUsd,
        expiresAt,
        renewUrl: `${appUrl}${upgradePath(plan.id)}`,
        name: row.display_name,
      });
      await emailer.send({ to, subject, html });
      summary.renewalEmails += 1;
    } catch (err) {
      summary.renewalErrors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
