import { PLANS, upgradePath } from '@/lib/plans';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/billing/translation-checkout: live meeting translation is part of
// Pro (and Team), so "buy" from the translation panel sends the host to the Pro
// checkout. The old Day/Month pass ids are accepted and answered the same way,
// so a desktop app from before this change still lands somewhere useful.
export async function POST() {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) return errorResponse('Sign in to upgrade to Pro', 401);
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com').replace(/\/+$/, '');
    return successResponse({
      checkout_url: `${base}${upgradePath('pro')}`,
      plan: 'pro',
      amount_usd: PLANS.pro.priceUsd,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
