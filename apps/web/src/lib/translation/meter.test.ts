import { describe, expect, it, vi } from 'vitest';
import { SpeechError } from '@profullstack/live-translate';

vi.mock('@/lib/supabase/service', () => ({ serviceClient: () => ({}) }));
const { SupabaseTranslationMeter } = await import('./meter');

/** A tiny stand-in for the supabase client: table reads answer from `rows`, rpc from `rpcs`. */
function fakeDb(options: {
  admins?: string[];
  wallet?: { balance_micros: number; expires_at: string } | null;
  rpcs?: Record<string, unknown>;
}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const query = (table: string) => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      gt: () => chain,
      maybeSingle: async () => {
        if (table === 'admin_users')
          return {
            data: options.admins?.includes(String(filters.user_id))
              ? { user_id: filters.user_id }
              : null,
          };
        if (table === 'translation_wallets') return { data: options.wallet ?? null };
        return { data: null };
      },
    };
    return chain;
  };
  return {
    calls,
    from: query,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: options.rpcs?.[name] ?? null, error: null };
    },
  };
}

describe('SupabaseTranslationMeter', () => {
  it('is a paid feature: no pass means 402', async () => {
    const meter = new SupabaseTranslationMeter(
      fakeDb({ rpcs: { translation_free_active: false } })
    );
    await expect(meter.require('host', 'meeting')).rejects.toMatchObject({ status: 402 });
    expect(await meter.funded('host', 'meeting')).toBe(false);
  });

  it('a live pass funds the meeting and reserves through the RPC', async () => {
    const db = fakeDb({
      wallet: { balance_micros: 1_000_000, expires_at: '2999-01-01' },
      rpcs: { translation_reserve: 'usage-1' },
    });
    const meter = new SupabaseTranslationMeter(db);
    expect(await meter.funded('host', 'meeting')).toBe(true);
    expect(await meter.reserve('host', 'voice', 100, 'meeting')).toBe('usage-1');
    const reserve = db.calls.find((call) => call.name === 'translation_reserve');
    expect(reserve?.args).toMatchObject({
      p_user: 'host',
      p_session: 'meeting',
      p_kind: 'voice',
      p_units: 100,
      p_cost: 5000,
      p_charge: 25000,
    });
    await meter.commit('usage-1');
    await meter.refund('usage-2');
    expect(
      db.calls
        .filter((call) => call.name === 'translation_settle')
        .map((call) => call.args.p_charged)
    ).toEqual([true, false]);
  });

  it('a spent wallet refuses the charge', async () => {
    const meter = new SupabaseTranslationMeter(fakeDb({ rpcs: { translation_reserve: null } }));
    await expect(meter.reserve('host', 'transcription', 32_000, 'meeting')).rejects.toBeInstanceOf(
      SpeechError
    );
  });

  it('admins use it unpaid and are never charged', async () => {
    const db = fakeDb({ admins: ['anthony'] });
    const meter = new SupabaseTranslationMeter(db);
    expect(await meter.isAdmin('anthony')).toBe(true);
    expect(await meter.isAdmin(null)).toBe(false);
    await expect(meter.require('anthony', 'meeting')).resolves.toBeUndefined();
    await expect(meter.begin('anthony', 'meeting')).resolves.toBeUndefined();
    expect(await meter.reserve('anthony', 'voice', 100, 'meeting')).toBe('');
    await meter.commit('');
    await meter.refund('');
    expect(await meter.funded('anthony', 'meeting')).toBe(true);
    expect(db.calls).toEqual([]);
  });

  it('a database failure is a 503, not a free pass', async () => {
    const db = { ...fakeDb({}), rpc: async () => ({ data: null, error: { message: 'down' } }) };
    const meter = new SupabaseTranslationMeter(db);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(meter.reserve('host', 'voice', 10, 'meeting')).rejects.toMatchObject({
      status: 503,
    });
  });
});
