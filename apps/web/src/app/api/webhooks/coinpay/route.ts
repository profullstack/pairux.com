/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCoinpayWebhook } from '@/lib/coinpay-client';
import { TERM_DAYS } from '@/lib/plans';
import { serviceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface NormalizedWebhook {
  eventType: string;
  paymentId: string | null;
  txHash: string | null;
}

// CoinPay sends either a nested ({ type, data: {...} }) or flat shape, so we
// read fields defensively from the parsed JSON.
function normalize(payload: any): NormalizedWebhook {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return {
    eventType: (payload?.type ?? payload?.event ?? '') as string,
    paymentId: (data?.payment_id ?? null) as string | null,
    txHash: (data?.tx_hash ?? data?.merchant_tx_hash ?? null) as string | null,
  };
}

export async function POST(request: NextRequest) {
  const secret = process.env.COINPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[coinpay webhook] COINPAY_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature =
    request.headers.get('x-coinpay-signature') ?? request.headers.get('x-coinpayportal-signature');
  if (!verifyCoinpayWebhook(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { eventType, paymentId, txHash } = normalize(payload);
  if (!paymentId) {
    return NextResponse.json({ error: 'Missing payment_id' }, { status: 400 });
  }

  let nextStatus: string | null = null;
  switch (eventType) {
    case 'payment.confirmed':
    case 'payment.completed':
      nextStatus = 'confirmed';
      break;
    case 'payment.forwarded':
      nextStatus = 'forwarded';
      break;
    case 'payment.expired':
      nextStatus = 'expired';
      break;
    case 'payment.failed':
      nextStatus = 'failed';
      break;
    default:
      return NextResponse.json({ received: true, ignored: eventType });
  }

  const supabase = serviceClient() as any;
  const now = new Date().toISOString();

  // Keep the payment row's status in sync.
  await supabase
    .from('plan_payments')
    .update({ status: nextStatus, tx_hash: txHash, updated_at: now })
    .eq('coinpay_payment_id', paymentId);

  // Grant the plan only on terminal success — confirmed (crypto) or forwarded
  // (merchant payout). Both can fire for one payment, so we gate on
  // credited_at: grant_plan extends the period exactly once.
  if (nextStatus === 'confirmed' || nextStatus === 'forwarded') {
    const { data: payment, error: lookupError } = await supabase
      .from('plan_payments')
      .select('user_id, plan, credited_at')
      .eq('coinpay_payment_id', paymentId)
      .maybeSingle();

    if (lookupError) {
      console.error('[coinpay webhook] payment lookup failed:', lookupError);
    } else if (payment && !payment.credited_at) {
      const { error: grantError } = await supabase.rpc('grant_plan', {
        p_user_id: payment.user_id,
        p_plan: payment.plan,
        p_days: TERM_DAYS,
      });
      if (grantError) {
        console.error('[coinpay webhook] grant_plan failed:', grantError);
      } else {
        await supabase
          .from('plan_payments')
          .update({ status: nextStatus, credited_at: now, updated_at: now })
          .eq('coinpay_payment_id', paymentId);
      }
    }
  }

  return NextResponse.json({ received: true });
}
