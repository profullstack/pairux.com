/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCoinPayWebhook } from '@profullstack/stack/coinpay';
import { asText, PAYMENT_PROPERTY, readCoinpayWebhook } from '@/lib/coinpay-client';
import { getPlanDef, TERM_DAYS } from '@/lib/plans';
import { translationPass } from '@/lib/translation/meter';
import { serviceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = new Set(['confirmed', 'forwarded', 'expired', 'failed']);

/**
 * CoinPay settles plan payments here: crypto (payment id), PayPal (CoinPay's
 * PayPal transaction id, sent as payment_id) and hosted checkout sessions
 * (payment_id plus checkout_session_id; our row is keyed by the session id).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.COINPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[coinpay webhook] COINPAY_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature =
    request.headers.get('x-coinpay-signature') ?? request.headers.get('x-coinpayportal-signature');
  if (!verifyCoinPayWebhook({ signature, rawBody, secret })) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const event = readCoinpayWebhook(payload);
  if (!event.paymentId && !event.sessionId) {
    return NextResponse.json({ error: 'Missing payment_id' }, { status: 400 });
  }
  if (!STATUSES.has(event.status)) {
    return NextResponse.json({ received: true, ignored: event.eventType || event.status });
  }

  const supabase = serviceClient() as any;
  const now = new Date().toISOString();
  const ids = [event.paymentId, event.sessionId].filter((id): id is string => Boolean(id));

  // Find our row by payment id, else by the session id it was opened under.
  const { data: rows, error: lookupError } = await supabase
    .from('plan_payments')
    .select('coinpay_payment_id, user_id, plan, credited_at, amount_usd')
    .in('coinpay_payment_id', ids)
    .limit(1);
  if (lookupError) {
    console.error('[coinpay webhook] payment lookup failed:', lookupError);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  let payment = rows?.[0] ?? null;

  // No row (the insert after create failed, or CoinPay opened the payment some
  // other way): rebuild it from our own metadata, but only for a settled pairux
  // plan payment that names an account and a plan we sell.
  if (!payment && event.settled) {
    const meta = event.metadata;
    const plan = getPlanDef(asText(meta.plan));
    const userId = asText(meta.account_id) || asText(meta.user_id);
    if (plan && userId && (asText(meta.property) || PAYMENT_PROPERTY) === PAYMENT_PROPERTY) {
      const key = event.paymentId ?? event.sessionId ?? '';
      const { error: insertError } = await supabase.from('plan_payments').insert({
        coinpay_payment_id: key,
        user_id: userId,
        plan: plan.id,
        amount_usd: event.amountUsd ?? plan.priceUsd,
        currency: 'WEBHOOK',
        status: 'pending',
        metadata: { rebuilt_from_webhook: true, ...meta },
      });
      if (insertError && insertError.code !== '23505') {
        console.error('[coinpay webhook] rebuild insert failed:', insertError);
        return NextResponse.json({ error: 'Record failed' }, { status: 500 });
      }
      payment = { coinpay_payment_id: key, user_id: userId, plan: plan.id, credited_at: null };
    }
  }

  if (!payment) {
    return NextResponse.json({ received: true, ignored: 'unknown payment' });
  }
  const rowKey = String(payment.coinpay_payment_id);

  // Keep the row's status in sync; never move a credited row off its success.
  if (!payment.credited_at) {
    await supabase
      .from('plan_payments')
      .update({ status: event.status, tx_hash: event.txHash, updated_at: now })
      .eq('coinpay_payment_id', rowKey);
  }

  if (!event.settled) return NextResponse.json({ received: true });

  if (String(payment.plan).startsWith('translation_')) {
    // Legacy prepaid translation credit: marked credited and added in one statement.
    const pass = translationPass(String(payment.plan));
    const { error: creditError } = await supabase.rpc('translation_credit_payment', {
      p_payment_id: rowKey,
      p_days: pass?.days ?? 1,
      p_status: event.status,
    });
    if (creditError) {
      console.error('[coinpay webhook] translation_credit_payment failed:', creditError);
      return NextResponse.json({ error: 'Credit failed' }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // Grant one term exactly once, even when confirmed and forwarded race.
  const { error: grantError } = await supabase.rpc('plan_credit_payment', {
    p_payment_id: rowKey,
    p_days: TERM_DAYS,
    p_status: event.status,
  });
  if (grantError) {
    console.error('[coinpay webhook] plan_credit_payment failed:', grantError);
    // 500 so CoinPay retries rather than the buyer paying for nothing.
    return NextResponse.json({ error: 'Grant failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
