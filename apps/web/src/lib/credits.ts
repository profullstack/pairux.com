/**
 * Redeemable credit codes and scarce invites (server only).
 *
 * - A credit code (@profullstack/redeem-credits, `CR-XXXX-XXXX-XXXX-XXXX`)
 *   grants days of a paid plan. The unit names the plan: `pro_days` (the
 *   default), `plus_days` or `team_days`. It is minted by an admin (/admin,
 *   POST /api/admin/credit-codes) and redeemed on the dashboard billing card,
 *   via POST /api/credits/redeem or `pairux redeem <code>`.
 * - An invite (@profullstack/affiliates, `INV-XXXX-XXXX-XXXX`) is scarce:
 *   INVITE_QUOTA per account. When a NEW account joins on one, both people get
 *   INVITE_BONUS_PRO_DAYS of Pro, once the new account has confirmed its email,
 *   unless the two addresses are the same mailbox or the inviter has had
 *   INVITE_BONUS_MONTHLY_CAP bonuses in the last 30 days.
 *
 * The plan is never tracked in a second place: every grant goes through the
 * plan_grant_days RPC, which extends profiles.plan / plan_expires_at exactly
 * like a CoinPay payment (a smaller plan while a bigger one runs adds time and
 * keeps the bigger plan). Web, desktop and mobile already read that. The
 * credit_ledger table is the audit trail of grants; invite_bonuses records
 * each bonus decision once (claimed before the grant).
 *
 * The open affiliate link is aff.affiliateCode() as `?ref=`; the middleware
 * keeps it in the `referral_code` cookie (@profullstack/referrals' name) and
 * signup records it with aff.attribute(). PairUX has no other referral
 * program, so nothing is counted twice.
 *
 * Clients are built lazily so env vars are read at runtime, not inlined at build.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isPlaceholderEmail } from './coinpay-signin';
import { Credits, supabaseStore as creditStore, type Grant } from '@profullstack/redeem-credits';
import { Affiliates, supabaseStore as affiliateStore } from '@profullstack/affiliates';
import type { Plan } from '@pairux/shared-types';
import { effectivePlan } from '@pairux/shared-types';
import { serviceClient } from '@/lib/supabase/service';

export type PaidPlan = Exclude<Plan, 'free'>;

/** Unit a code grants: `<plan>_days`. pro_days is the default. */
export const PLAN_DAY_UNITS: Record<PaidPlan, string> = {
  plus: 'plus_days',
  pro: 'pro_days',
  team: 'team_days',
};
export const PRO_DAYS_UNIT = PLAN_DAY_UNITS.pro;

/** Invites every account may create (admins can raise one user's with setQuota). */
export const INVITE_QUOTA = 3;
/** Pro days each side gets when an invited account qualifies. */
export const INVITE_BONUS_PRO_DAYS = 7;
/** An account can hand out invites once it is this old (stops sock-puppet chains). */
export const INVITE_MIN_INVITER_AGE_DAYS = 7;
/** Only accounts at most this old can accept an invite: invites are for new people. */
export const INVITE_ACCEPT_MAX_ACCOUNT_AGE_DAYS = 7;
/** Most inviter-side bonuses one account gets in 30 days (both sides are refused past it). */
export const INVITE_BONUS_MONTHLY_CAP = 10;
/** Invite codes expire after this many days. */
export const INVITE_TTL_DAYS = 30;
/** Cookie /i/<code> sets so the code survives the trip through signup. */
export const INVITE_COOKIE = 'pairux_invite';
/** @profullstack/referrals' cookie name; the middleware stores ?ref= in it. */
export { REF_COOKIE, refFromRequest } from '@profullstack/affiliates';

const DAY_MS = 24 * 60 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export interface CreditDeps {
  db: Db;
  credits: Credits;
  affiliates: Affiliates;
  now: () => number;
}

/** Build the services over a supabase-js service-role client. */
export function buildCreditDeps(db: Db, now: () => number = Date.now): CreditDeps {
  const credits = new Credits(creditStore(db as never), {
    now,
    onGrant: async (userId: string, grant: Grant, source: string) => {
      await applyGrant(db, userId, grant, source);
    },
  });
  const affiliates = new Affiliates(affiliateStore(db as never), {
    now,
    defaultQuota: INVITE_QUOTA,
    inviteTtlMs: INVITE_TTL_DAYS * DAY_MS,
  });
  return { db, credits, affiliates, now };
}

let deps: CreditDeps | undefined;
export function getCreditDeps(): CreditDeps {
  return (deps ??= buildCreditDeps(serviceClient() as unknown as Db));
}

/** Test hook. */
export function setCreditDepsForTest(next: CreditDeps | undefined): void {
  deps = next;
}

export function planForUnit(unit: string): PaidPlan | null {
  for (const [plan, u] of Object.entries(PLAN_DAY_UNITS) as [PaidPlan, string][]) {
    if (u === unit) return plan;
  }
  return null;
}

/** Mirror one committed grant into profiles.plan / plan_expires_at. */
export async function applyGrant(db: Db, userId: string, grant: Grant, source: string) {
  const plan = planForUnit(grant.unit);
  if (!plan) {
    console.error('[credits] grant with an unknown unit ignored', {
      userId,
      unit: grant.unit,
      source,
    });
    return;
  }
  const { error } = await db.rpc('plan_grant_days', {
    p_user_id: userId,
    p_plan: plan,
    p_days: Math.round(grant.amount),
  });
  if (error) throw new Error(`plan_grant_days: ${error.message}`);
}

// ── Plan view ─────────────────────────────────────────────────────────

export interface PlanView {
  plan: Plan;
  effectivePlan: Plan;
  planExpiresAt: string | null;
}

export async function planView(db: Db, userId: string): Promise<PlanView> {
  const { data } = (await db
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', userId)
    .maybeSingle()) as { data: { plan: Plan; plan_expires_at: string | null } | null };
  const plan = data?.plan ?? 'free';
  const planExpiresAt = data?.plan_expires_at ?? null;
  return { plan, planExpiresAt, effectivePlan: effectivePlan(plan, planExpiresAt) };
}

// ── Credit codes ──────────────────────────────────────────────────────

export type RedeemFailure = 'invalid' | 'expired' | 'used_up' | 'already_redeemed' | 'revoked';

export const REDEEM_MESSAGES: Record<RedeemFailure, string> = {
  invalid: 'That code is not valid. Check it and try again.',
  expired: 'That code has expired.',
  used_up: 'That code has already been used.',
  already_redeemed: 'You have already redeemed that code.',
  revoked: 'That code is no longer valid.',
};

export async function redeemCreditCode(
  userId: string,
  code: string,
  d: CreditDeps = getCreditDeps()
): Promise<
  | { ok: true; plan: PaidPlan; days: number; view: PlanView }
  | { ok: false; reason: RedeemFailure; message: string }
> {
  const r = await d.credits.redeem(code, userId);
  if (!r.ok) return { ok: false, reason: r.reason, message: REDEEM_MESSAGES[r.reason] };
  return {
    ok: true,
    plan: planForUnit(r.grant.unit) ?? 'pro',
    days: r.grant.amount,
    view: await planView(d.db, userId),
  };
}

export interface MintInput {
  days: number;
  plan?: PaidPlan;
  label?: string | undefined;
  maxRedemptions?: number;
  expiresAt?: number | null;
  createdBy?: string;
}

export async function mintCreditCode(o: MintInput, d: CreditDeps = getCreditDeps()) {
  const plan = o.plan ?? 'pro';
  if (!(plan in PLAN_DAY_UNITS)) throw new TypeError('plan must be plus, pro or team');
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > 3660) {
    throw new TypeError('days must be a whole number from 1 to 3660');
  }
  const max = o.maxRedemptions ?? 1;
  if (!Number.isInteger(max) || max < 1 || max > 10_000) {
    throw new TypeError('maxRedemptions must be a whole number from 1 to 10000');
  }
  const label = o.label?.trim() ? o.label.trim().slice(0, 200) : undefined;
  return d.credits.mint({
    grant: { unit: PLAN_DAY_UNITS[plan], amount: o.days },
    label:
      label ?? `${String(o.days)} days of PairUX ${plan[0]?.toUpperCase() ?? ''}${plan.slice(1)}`,
    maxRedemptions: max,
    expiresAt: o.expiresAt ?? null,
    ...(o.createdBy ? { createdBy: o.createdBy } : {}),
  });
}

// ── Invites ───────────────────────────────────────────────────────────

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  created_at: string | null;
}

async function getProfile(db: Db, userId: string): Promise<ProfileRow | null> {
  const { data } = (await db
    .from('profiles')
    .select('id, username, display_name, email, created_at')
    .eq('id', userId)
    .maybeSingle()) as { data: ProfileRow | null };
  return data ?? null;
}

function ageDays(createdAt: string | null | undefined, now: number): number {
  if (!createdAt) return 0;
  return (now - new Date(createdAt).getTime()) / DAY_MS;
}

/**
 * One mailbox, however it is spelled: lowercased, `+tag` dropped, and for
 * Gmail the dots too (googlemail.com is gmail.com).
 */
export function mailboxKey(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at <= 0) return null;
  const e = email.trim().toLowerCase();
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

export interface InviteRow {
  id: string;
  createdAt: number;
  expiresAt: number | null;
  usedBy: string | null;
  usedAt: number | null;
  note: string;
  revokedAt: number | null;
  status: 'open' | 'used' | 'expired' | 'revoked';
  usedByName?: string | null;
  bonus?: 'granted' | 'denied' | 'pending';
}

interface BonusRow {
  invite_id: string;
  side: 'inviter' | 'invitee';
  user_id: string;
  outcome: 'granted' | 'denied';
  reason: string | null;
  created_at: string;
}

async function bonusRows(db: Db, inviteIds: string[]): Promise<BonusRow[]> {
  if (!inviteIds.length) return [];
  const { data } = (await db
    .from('invite_bonuses')
    .select('invite_id, side, user_id, outcome, reason, created_at')
    .in('invite_id', inviteIds)) as { data: BonusRow[] | null };
  return data ?? [];
}

export async function inviteOverview(userId: string, d: CreditDeps = getCreditDeps()) {
  const now = d.now();
  const [quota, raw, profile] = await Promise.all([
    d.affiliates.quota(userId),
    d.affiliates.invites(userId),
    getProfile(d.db, userId),
  ]);
  const usedIds = raw.map((i) => i.usedBy).filter((u): u is string => !!u);
  const names = new Map<string, string | null>();
  if (usedIds.length) {
    const { data } = (await d.db
      .from('profiles')
      .select('id, username, display_name')
      .in('id', usedIds)) as {
      data: { id: string; username: string | null; display_name: string | null }[] | null;
    };
    for (const p of data ?? []) names.set(p.id, p.username ? `@${p.username}` : p.display_name);
  }
  const bonuses = await bonusRows(
    d.db,
    raw.filter((i) => i.usedBy).map((i) => i.id)
  );
  const invites: InviteRow[] = raw.map((i) => {
    const mine = bonuses.find((b) => b.invite_id === i.id && b.side === 'inviter');
    return {
      id: i.id,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      usedBy: i.usedBy,
      usedAt: i.usedAt,
      note: i.note,
      revokedAt: i.revokedAt ?? null,
      status: i.usedBy
        ? 'used'
        : i.revokedAt
          ? 'revoked'
          : i.expiresAt !== null && now >= i.expiresAt
            ? 'expired'
            : 'open',
      ...(i.usedBy
        ? { usedByName: names.get(i.usedBy) ?? null, bonus: mine ? mine.outcome : 'pending' }
        : {}),
    };
  });
  const canInvite = ageDays(profile?.created_at, now) >= INVITE_MIN_INVITER_AGE_DAYS;
  return {
    quota,
    invites,
    canInvite,
    unlocksAt:
      !canInvite && profile?.created_at
        ? new Date(
            new Date(profile.created_at).getTime() + INVITE_MIN_INVITER_AGE_DAYS * DAY_MS
          ).toISOString()
        : null,
    bonusDays: INVITE_BONUS_PRO_DAYS,
    affiliateCode: await d.affiliates.affiliateCode(userId),
  };
}

export class InviteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string
  ) {
    super(message);
  }
}

export async function createInvite(userId: string, note = '', d: CreditDeps = getCreditDeps()) {
  const profile = await getProfile(d.db, userId);
  if (!profile) throw new InviteError('Profile not found.', 404, 'no_profile');
  if (ageDays(profile.created_at, d.now()) < INVITE_MIN_INVITER_AGE_DAYS) {
    throw new InviteError(
      `Invites unlock once your account is ${String(INVITE_MIN_INVITER_AGE_DAYS)} days old.`,
      403,
      'too_new'
    );
  }
  try {
    return await d.affiliates.createInvite(userId, note.slice(0, 200));
  } catch (err) {
    if (/no invites left/i.test((err as Error).message)) {
      throw new InviteError('You have no invites left.', 409, 'no_invites_left');
    }
    throw err;
  }
}

export async function revokeInvite(
  userId: string,
  inviteId: string,
  d: CreditDeps = getCreditDeps()
) {
  const mine = (await d.affiliates.invites(userId)).find((i) => i.id === inviteId);
  if (!mine) throw new InviteError('Invite not found.', 404, 'not_found');
  if (mine.usedBy) throw new InviteError('That invite has already been used.', 409, 'used');
  await d.affiliates.revokeInvite(inviteId);
}

export const ACCEPT_MESSAGES: Record<string, string> = {
  invalid: 'That invite code is not valid.',
  expired: 'That invite has expired.',
  used: 'That invite has already been used.',
  self: 'You cannot use your own invite.',
  revoked: 'That invite was withdrawn.',
  already_invited: 'Your account has already joined on an invite.',
  not_new: `Invites are for new accounts (${String(INVITE_ACCEPT_MAX_ACCOUNT_AGE_DAYS)} days old or less).`,
  no_profile: 'Profile not found.',
};

export type AcceptResult =
  | { ok: true; inviterId: string; inviteId: string; bonus: 'granted' | 'pending' | 'denied' }
  | { ok: false; reason: string; message: string };

/**
 * Spend an invite on a new account and record who invited whom, then settle
 * the bonus (granted now if the email is confirmed, otherwise on confirmation).
 */
export async function acceptInvite(
  userId: string,
  code: string,
  d: CreditDeps = getCreditDeps()
): Promise<AcceptResult> {
  const fail = (reason: string) => ({
    ok: false as const,
    reason,
    message: ACCEPT_MESSAGES[reason] ?? reason,
  });
  const profile = await getProfile(d.db, userId);
  if (!profile) return fail('no_profile');
  if (ageDays(profile.created_at, d.now()) > INVITE_ACCEPT_MAX_ACCOUNT_AGE_DAYS)
    return fail('not_new');
  if (await d.affiliates.invitedBy(userId)) return fail('already_invited');

  const r = await d.affiliates.redeemInvite(code, userId);
  if (!r.ok) return fail(r.reason);

  const settled = await settleInviteBonus(userId, d);
  return {
    ok: true,
    inviterId: r.inviterId,
    inviteId: r.inviteId,
    bonus:
      settled.status === 'granted' || settled.status === 'already'
        ? 'granted'
        : settled.status === 'denied'
          ? 'denied'
          : 'pending',
  };
}

async function emailOf(
  db: Db,
  userId: string
): Promise<{ email: string | null; confirmed: boolean }> {
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error) return { email: null, confirmed: false };
  const u = data.user as { email?: string | null; email_confirmed_at?: string | null } | null;
  if (!u) return { email: null, confirmed: false };
  // A CoinPay-made account's address is our own undeliverable placeholder,
  // confirmed only so a session can be minted for it: not a verified email.
  return {
    email: u.email ?? null,
    confirmed: Boolean(u.email_confirmed_at) && !isPlaceholderEmail(u.email),
  };
}

/** Claim a (invite, side) decision; false when one was already recorded. */
async function claim(
  db: Db,
  row: Omit<BonusRow, 'created_at'> & { days: number }
): Promise<boolean> {
  const { data, error } = (await db
    .from('invite_bonuses')
    .upsert(row, { onConflict: 'invite_id,side', ignoreDuplicates: true })
    .select('invite_id')) as { data: unknown[] | null; error: { message: string } | null };
  if (error) throw new Error(`invite_bonuses: ${error.message}`);
  return (data ?? []).length > 0;
}

async function unclaim(db: Db, inviteId: string, side: string) {
  await db.from('invite_bonuses').delete().eq('invite_id', inviteId).eq('side', side);
}

async function grantSide(
  d: CreditDeps,
  inviteId: string,
  side: 'inviter' | 'invitee',
  userId: string
) {
  const won = await claim(d.db, {
    invite_id: inviteId,
    side,
    user_id: userId,
    outcome: 'granted',
    reason: null,
    days: INVITE_BONUS_PRO_DAYS,
  });
  if (!won) return false;
  try {
    await d.credits.grant(
      userId,
      { unit: PRO_DAYS_UNIT, amount: INVITE_BONUS_PRO_DAYS },
      `invite:${inviteId}:${side}`
    );
  } catch (err) {
    // Let a later settle retry: nothing was granted.
    await unclaim(d.db, inviteId, side);
    throw err;
  }
  return true;
}

async function inviterBonusesLast30Days(d: CreditDeps, inviterId: string): Promise<number> {
  const since = new Date(d.now() - 30 * DAY_MS).toISOString();
  const { data } = (await d.db
    .from('invite_bonuses')
    .select('invite_id')
    .eq('user_id', inviterId)
    .eq('side', 'inviter')
    .eq('outcome', 'granted')
    .gte('created_at', since)) as { data: unknown[] | null };
  return (data ?? []).length;
}

export type SettleResult =
  | { status: 'none' }
  | { status: 'pending'; reason: string }
  | { status: 'denied'; reason: string }
  | { status: 'granted' | 'already'; inviteId: string; inviterId: string };

/**
 * Grant the invite bonus to both sides if the invited account qualifies now.
 * Idempotent: each side is decided once per invite. Safe to call often.
 */
export async function settleInviteBonus(
  inviteeId: string,
  d: CreditDeps = getCreditDeps()
): Promise<SettleResult> {
  const inviterId = await d.affiliates.invitedBy(inviteeId);
  if (!inviterId) return { status: 'none' };
  const invite = (await d.affiliates.invites(inviterId)).find((i) => i.usedBy === inviteeId);
  if (!invite) return { status: 'none' };

  const existing = await bonusRows(d.db, [invite.id]);
  if (existing.length >= 2) {
    const denied = existing.find((b) => b.outcome === 'denied');
    return denied
      ? { status: 'denied', reason: denied.reason ?? 'denied' }
      : { status: 'already', inviteId: invite.id, inviterId };
  }

  const [invitee, inviter] = await Promise.all([
    emailOf(d.db, inviteeId),
    emailOf(d.db, inviterId),
  ]);
  if (!invitee.confirmed) return { status: 'pending', reason: 'email not confirmed' };

  let deny: string | null = null;
  const a = mailboxKey(invitee.email);
  if (a && a === mailboxKey(inviter.email)) deny = 'same_mailbox';
  else if ((await inviterBonusesLast30Days(d, inviterId)) >= INVITE_BONUS_MONTHLY_CAP)
    deny = 'monthly_cap';
  if (deny) {
    for (const [side, uid] of [
      ['invitee', inviteeId],
      ['inviter', inviterId],
    ] as const) {
      await claim(d.db, {
        invite_id: invite.id,
        side,
        user_id: uid,
        outcome: 'denied',
        reason: deny,
        days: 0,
      });
    }
    console.warn('[invites] bonus denied', { inviteId: invite.id, inviteeId, inviterId, deny });
    return { status: 'denied', reason: deny };
  }

  const gotInvitee = await grantSide(d, invite.id, 'invitee', inviteeId);
  const gotInviter = await grantSide(d, invite.id, 'inviter', inviterId);
  return {
    status: gotInvitee || gotInviter ? 'granted' : 'already',
    inviteId: invite.id,
    inviterId,
  };
}

/** Settle every used invite this user sent (cheap: at most the quota). */
export async function settleInvitesSentBy(inviterId: string, d: CreditDeps = getCreditDeps()) {
  for (const inv of await d.affiliates.invites(inviterId)) {
    if (!inv.usedBy) continue;
    try {
      await settleInviteBonus(inv.usedBy, d);
    } catch (err) {
      console.error('[invites] settle failed', { inviteId: inv.id, err });
    }
  }
}

/**
 * After a sign-in or signup: accept a pending invite code (from the /i/<code>
 * cookie) and record a ?ref= attribution, then settle any bonus. Never throws:
 * signing in must not fail on an invite.
 */
export async function onSignedIn(
  userId: string,
  opts: { inviteCode?: string | null; refCode?: string | null },
  d: CreditDeps = getCreditDeps()
): Promise<{ invite?: AcceptResult; settled?: SettleResult }> {
  const out: { invite?: AcceptResult; settled?: SettleResult } = {};
  try {
    if (opts.refCode) await d.affiliates.attribute(opts.refCode, userId);
  } catch (err) {
    console.error('[affiliates] attribute failed', err);
  }
  try {
    if (opts.inviteCode && !(await d.affiliates.invitedBy(userId))) {
      out.invite = await acceptInvite(userId, opts.inviteCode, d);
    } else {
      out.settled = await settleInviteBonus(userId, d);
    }
  } catch (err) {
    console.error('[invites] sign-in settle failed', err);
  }
  return out;
}

/** The public origin for links: NEXT_PUBLIC_APP_URL, else the request's host. */
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured && !/localhost|127\.0\.0\.1/.test(configured))
    return configured.replace(/\/$/, '');
  const h = request.headers;
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : 'https://pairux.com';
}

export function inviteUrl(origin: string, code: string) {
  return `${origin.replace(/\/$/, '')}/i/${encodeURIComponent(code)}`;
}

export function refUrl(origin: string, code: string) {
  return `${origin.replace(/\/$/, '')}/?ref=${encodeURIComponent(code)}`;
}

/** Read one cookie from a raw Cookie header. */
export function cookieFrom(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return v.join('=');
      }
    }
  }
  return null;
}
