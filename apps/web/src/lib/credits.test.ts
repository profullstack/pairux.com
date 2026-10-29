/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';
import { Credits, memoryStore as creditMemory } from '@profullstack/redeem-credits';
import { Affiliates, memoryStore as affMemory } from '@profullstack/affiliates';
import {
  INVITE_BONUS_MONTHLY_CAP,
  INVITE_BONUS_PRO_DAYS,
  acceptInvite,
  applyGrant,
  createInvite,
  inviteOverview,
  mailboxKey,
  mintCreditCode,
  onSignedIn,
  redeemCreditCode,
  revokeInvite,
  settleInviteBonus,
  type CreditDeps,
} from './credits';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-26T12:00:00Z');
const RANK = ['free', 'plus', 'pro', 'team'];

type Row = Record<string, any>;

/** Just enough of supabase-js (and the plan_grant_days RPC) for credits.ts. */
function fakeDb() {
  const tables: Record<string, Row[]> = { profiles: [], invite_bonuses: [] };
  const users = new Map<string, { email: string; email_confirmed_at: string | null }>();

  function query(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let op: 'select' | 'delete' | 'upsert' = 'select';
    let pending: Row | null = null;
    let opts: { onConflict: string; ignoreDuplicates?: boolean } | null = null;
    const t = () => (tables[table] ??= []);
    const rows = () => t().filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (op === 'delete') {
        tables[table] = t().filter((r) => !filters.every((f) => f(r)));
        return { data: null, error: null };
      }
      if (op === 'upsert' && pending && opts) {
        const keys = opts.onConflict.split(',');
        const hit = t().find((r) => keys.every((k) => r[k] === pending?.[k]));
        if (hit) return { data: [], error: null };
        const row = { created_at: new Date(NOW).toISOString(), ...pending };
        t().push(row);
        return { data: [row], error: null };
      }
      return { data: rows(), error: null };
    };
    const q: any = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
      gte: (k: string, v: string) => (filters.push((r) => String(r[k]) >= v), q),
      delete: () => ((op = 'delete'), q),
      upsert: (row: Row, o: { onConflict: string }) => (
        (op = 'upsert'),
        (pending = row),
        (opts = o),
        q
      ),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
        try {
          res(run());
        } catch (e) {
          rej?.(e);
        }
      },
    };
    return q;
  }

  const db: any = {
    from: query,
    rpc: async (fn: string, a: any) => {
      if (fn !== 'plan_grant_days') return { data: null, error: { message: `no rpc ${fn}` } };
      const p = tables.profiles?.find((r) => r.id === a.p_user_id);
      if (!p) return { data: null, error: { message: 'no profile' } };
      const running = p.plan_expires_at && Date.parse(p.plan_expires_at) > Date.now();
      if (!(running && RANK.indexOf(p.plan) > RANK.indexOf(a.p_plan))) p.plan = a.p_plan;
      const base = Math.max(Date.now(), p.plan_expires_at ? Date.parse(p.plan_expires_at) : 0);
      p.plan_expires_at = new Date(base + a.p_days * DAY).toISOString();
      return { data: p.plan_expires_at, error: null };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const u = users.get(id);
          return u
            ? { data: { user: { id, ...u } }, error: null }
            : { data: { user: null }, error: { message: 'nope' } };
        },
      },
    },
  };
  return { db, tables, users };
}

let env: ReturnType<typeof fakeDb>;
let deps: CreditDeps;

function addUser(id: string, o: { ageDays: number; confirmed?: boolean; email?: string }) {
  env.tables.profiles?.push({
    id,
    username: id,
    display_name: id,
    email: o.email ?? `${id}@example.com`,
    created_at: new Date(NOW - o.ageDays * DAY).toISOString(),
    plan: 'free',
    plan_expires_at: null,
  });
  env.users.set(id, {
    email: o.email ?? `${id}@example.com`,
    email_confirmed_at: o.confirmed === false ? null : new Date(NOW).toISOString(),
  });
}

const profile = (id: string) => env.tables.profiles!.find((p) => p.id === id)!;
const daysLeft = (id: string) => (Date.parse(profile(id).plan_expires_at) - Date.now()) / DAY;

beforeEach(() => {
  env = fakeDb();
  const now = () => NOW;
  deps = {
    db: env.db,
    now,
    credits: new Credits(creditMemory(), {
      now,
      onGrant: (u, g, s) => applyGrant(env.db, u, g, s),
    }),
    affiliates: new Affiliates(affMemory(), { now, defaultQuota: 3, inviteTtlMs: 30 * DAY }),
  };
  addUser('alice', { ageDays: 60 });
});

describe('credit codes', () => {
  it('grants days of Pro through profiles.plan / plan_expires_at', async () => {
    const { code } = await mintCreditCode({ days: 30 }, deps);
    const r = await redeemCreditCode('alice', code.toLowerCase().replace(/-/g, ' '), deps);
    expect(r).toMatchObject({ ok: true, plan: 'pro', days: 30 });
    expect(profile('alice').plan).toBe('pro');
    expect(daysLeft('alice')).toBeCloseTo(30, 0);
    if (r.ok) expect(r.view.effectivePlan).toBe('pro');
  });

  it('lets the mint choose the plan', async () => {
    const { code } = await mintCreditCode({ days: 10, plan: 'team' }, deps);
    expect(await redeemCreditCode('alice', code, deps)).toMatchObject({ ok: true, plan: 'team' });
    expect(profile('alice').plan).toBe('team');
  });

  it('extends a running period and keeps a bigger running plan', async () => {
    const p = profile('alice');
    p.plan = 'team';
    p.plan_expires_at = new Date(Date.now() + 10 * DAY).toISOString();
    const { code } = await mintCreditCode({ days: 5 }, deps);
    await redeemCreditCode('alice', code, deps);
    expect(p.plan).toBe('team');
    expect(daysLeft('alice')).toBeCloseTo(15, 0);
  });

  it('refuses bad, reused and used-up codes with friendly messages', async () => {
    expect(await redeemCreditCode('alice', 'CR-NOPE', deps)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    const { code } = await mintCreditCode({ days: 5 }, deps);
    await redeemCreditCode('alice', code, deps);
    expect(await redeemCreditCode('alice', code, deps)).toMatchObject({
      ok: false,
      reason: 'already_redeemed',
    });
    addUser('bob', { ageDays: 1 });
    const r = await redeemCreditCode('bob', code, deps);
    expect(r).toMatchObject({ ok: false, reason: 'used_up' });
    if (!r.ok) expect(r.message).toMatch(/already been used/);
  });

  it('validates mint input', async () => {
    await expect(mintCreditCode({ days: 0 }, deps)).rejects.toThrow();
    await expect(mintCreditCode({ days: 1.5 }, deps)).rejects.toThrow();
    await expect(mintCreditCode({ days: 5, plan: 'gold' as never }, deps)).rejects.toThrow();
  });
});

describe('mailboxKey', () => {
  it('treats +tags, case and Gmail dots as one mailbox', () => {
    expect(mailboxKey('Ann+pairux@Example.com')).toBe('ann@example.com');
    expect(mailboxKey('a.n.n@googlemail.com')).toBe(mailboxKey('ann+x@gmail.com'));
    expect(mailboxKey('a.nn@example.com')).not.toBe(mailboxKey('ann@example.com'));
    expect(mailboxKey(null)).toBeNull();
  });
});

describe('invites', () => {
  it('needs a week-old account to invite', async () => {
    addUser('newbie', { ageDays: 2 });
    await expect(createInvite('newbie', '', deps)).rejects.toMatchObject({
      reason: 'too_new',
      status: 403,
    });
    const o = await inviteOverview('newbie', deps);
    expect(o.canInvite).toBe(false);
    expect(o.unlocksAt).not.toBeNull();
  });

  it('caps invites at 3 and refunds a withdrawn one', async () => {
    const a = await createInvite('alice', 'one', deps);
    await createInvite('alice', 'two', deps);
    await createInvite('alice', 'three', deps);
    await expect(createInvite('alice', 'four', deps)).rejects.toMatchObject({
      reason: 'no_invites_left',
      status: 409,
    });
    await revokeInvite('alice', a.id, deps);
    expect((await inviteOverview('alice', deps)).quota.left).toBe(1);
  });

  it('gives both sides Pro days once a confirmed new account accepts', async () => {
    const inv = await createInvite('alice', 'for Carol', deps);
    addUser('carol', { ageDays: 0 });
    expect(await acceptInvite('carol', inv.code, deps)).toMatchObject({
      ok: true,
      bonus: 'granted',
    });
    for (const u of ['alice', 'carol']) {
      expect(profile(u).plan).toBe('pro');
      expect(daysLeft(u)).toBeCloseTo(INVITE_BONUS_PRO_DAYS, 0);
    }
    const end = profile('carol').plan_expires_at;
    expect((await settleInviteBonus('carol', deps)).status).toBe('already');
    expect(profile('carol').plan_expires_at).toBe(end);
    const o = await inviteOverview('alice', deps);
    expect(o.invites[0]).toMatchObject({ status: 'used', usedByName: '@carol', bonus: 'granted' });
  });

  it('holds the bonus until the email is confirmed, then pays once', async () => {
    const inv = await createInvite('alice', '', deps);
    addUser('dan', { ageDays: 0, confirmed: false });
    expect(await acceptInvite('dan', inv.code, deps)).toMatchObject({ ok: true, bonus: 'pending' });
    expect(profile('dan').plan).toBe('free');
    env.users.get('dan')!.email_confirmed_at = new Date(NOW).toISOString();
    expect((await onSignedIn('dan', {}, deps)).settled?.status).toBe('granted');
    expect(profile('dan').plan).toBe('pro');
    expect((await settleInviteBonus('dan', deps)).status).toBe('already');
    expect(daysLeft('alice')).toBeCloseTo(INVITE_BONUS_PRO_DAYS, 0);
  });

  it('a CoinPay-made account (placeholder address) never counts as confirmed', async () => {
    const inv = await createInvite('alice', '', deps);
    addUser('cpuser', { ageDays: 0, email: 'cp-0123abcd@coinpay.pairux.invalid' });
    expect(await acceptInvite('cpuser', inv.code, deps)).toMatchObject({
      ok: true,
      bonus: 'pending',
    });
    expect(profile('cpuser').plan).toBe('free');
    expect(profile('alice').plan).toBe('free');
  });

  it('pays nothing when both addresses are the same mailbox', async () => {
    env.users.get('alice')!.email = 'alice@gmail.com';
    const inv = await createInvite('alice', '', deps);
    addUser('alt', { ageDays: 0, email: 'a.lice+alt@gmail.com' });
    expect(await acceptInvite('alt', inv.code, deps)).toMatchObject({ ok: true, bonus: 'denied' });
    expect(profile('alt').plan).toBe('free');
    expect(profile('alice').plan).toBe('free');
    expect(env.tables.invite_bonuses?.every((b) => b.reason === 'same_mailbox')).toBe(true);
  });

  it('refuses old accounts, second invites and your own invite', async () => {
    const inv = await createInvite('alice', '', deps);
    addUser('old', { ageDays: 30 });
    expect(await acceptInvite('old', inv.code, deps)).toMatchObject({
      ok: false,
      reason: 'not_new',
    });
    expect(await acceptInvite('alice', inv.code, deps)).toMatchObject({
      ok: false,
      reason: 'not_new',
    });
    addUser('erin', { ageDays: 0 });
    await acceptInvite('erin', inv.code, deps);
    const inv2 = await createInvite('alice', '', deps);
    expect(await acceptInvite('erin', inv2.code, deps)).toMatchObject({
      ok: false,
      reason: 'already_invited',
    });
  });

  it('stops paying an inviter past the monthly cap', async () => {
    await deps.affiliates.setQuota('alice', INVITE_BONUS_MONTHLY_CAP + 1);
    for (let i = 0; i < INVITE_BONUS_MONTHLY_CAP; i++) {
      const inv = await createInvite('alice', '', deps);
      addUser(`u${String(i)}`, { ageDays: 0 });
      expect(await acceptInvite(`u${String(i)}`, inv.code, deps)).toMatchObject({
        bonus: 'granted',
      });
    }
    const inv = await createInvite('alice', '', deps);
    addUser('late', { ageDays: 0 });
    expect(await acceptInvite('late', inv.code, deps)).toMatchObject({ ok: true, bonus: 'denied' });
    expect(profile('late').plan).toBe('free');
    expect(daysLeft('alice')).toBeCloseTo(INVITE_BONUS_PRO_DAYS * INVITE_BONUS_MONTHLY_CAP, 0);
  });

  it('records a ?ref= signup first-touch and accepts a cookie invite on sign-in', async () => {
    const ref = await deps.affiliates.affiliateCode('alice');
    const inv = await createInvite('alice', '', deps);
    addUser('fay', { ageDays: 0 });
    const r = await onSignedIn('fay', { inviteCode: inv.code, refCode: ref }, deps);
    expect(r.invite).toMatchObject({ ok: true, bonus: 'granted' });
    expect(await deps.affiliates.affiliateOf('fay')).toBe('alice');
  });
});
