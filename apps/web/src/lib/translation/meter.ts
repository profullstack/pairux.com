/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import {
  SpeechError,
  translationCost,
  type TranslationMeter,
  type TranslationUsage,
} from '@profullstack/live-translate';
import { serviceClient } from '@/lib/supabase/service';

/** Live translation is a paid feature: a host needs a Day or Month pass.
 * PAIRUX_TRANSLATION_FREE_MEETINGS (default 0) can open a free trial per day. */
export const FREE_MEETINGS_PER_DAY = Number(process.env.PAIRUX_TRANSLATION_FREE_MEETINGS ?? 0);
/** A free meeting stays claimed while translation runs and this long after. */
export const FREE_LEASE_SECONDS = 90;

export const TRANSLATION_PASSES = [
  { id: 'translation_day', name: 'Day pass', days: 1, priceUsd: 1 },
  { id: 'translation_month', name: 'Month pass', days: 30, priceUsd: 5 },
] as const;
export type TranslationPassId = (typeof TRANSLATION_PASSES)[number]['id'];
export const translationPass = (id: string) => TRANSLATION_PASSES.find((pass) => pass.id === id);

const NO_CREDIT =
  'Live translation is a paid feature: the meeting host needs a translation pass (Day $1 or Month $5), or their credit is used up.';

/** The package's meter over Supabase RPCs (see the meeting_translation
 * migration). `by` is always the meeting host; `resource` the meeting id. */
export class SupabaseTranslationMeter implements TranslationMeter {
  private readonly admins = new Map<string, { admin: boolean; until: number }>();
  constructor(private readonly db: any = serviceClient()) {}

  /** PairUX admins (admin_users, as /admin checks) use translation unpaid. */
  async isAdmin(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    const cached = this.admins.get(userId);
    if (cached && cached.until > Date.now()) return cached.admin;
    const { data } = await this.db
      .from('admin_users')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    const admin = Boolean(data);
    this.admins.set(userId, { admin, until: Date.now() + 300_000 });
    return admin;
  }

  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(name, args);
    if (error) {
      console.error(`[translation] ${name} failed:`, error);
      throw new SpeechError('Translation billing is unavailable. Try again shortly.', 503);
    }
    return data as T;
  }

  async begin(by: string, resource: string): Promise<void> {
    if (await this.isAdmin(by)) return;
    if (
      await this.rpc<boolean>('translation_free_begin', {
        p_user: by,
        p_session: resource,
        p_limit: FREE_MEETINGS_PER_DAY,
        p_lease_seconds: FREE_LEASE_SECONDS,
      })
    )
      return;
    await this.require(by, resource);
  }

  async require(by: string, resource = ''): Promise<void> {
    if (await this.isAdmin(by)) return;
    if (
      resource &&
      (await this.rpc<boolean>('translation_free_active', {
        p_user: by,
        p_session: resource,
        p_lease_seconds: FREE_LEASE_SECONDS,
      }))
    )
      return;
    const { data } = await this.db
      .from('translation_wallets')
      .select('balance_micros')
      .eq('user_id', by)
      .gt('expires_at', new Date().toISOString())
      .gt('balance_micros', 0)
      .maybeSingle();
    if (!data) throw new SpeechError(NO_CREDIT, 402);
  }

  async reserve(by: string, kind: TranslationUsage, units: number, resource = ''): Promise<string> {
    // No reservation id = nothing to commit or refund (the package skips both).
    if (await this.isAdmin(by)) return '';
    const { cost, charge } = translationCost(kind, units);
    const id = await this.rpc<string | null>('translation_reserve', {
      p_user: by,
      p_session: resource,
      p_kind: kind,
      p_units: units,
      p_cost: cost,
      p_charge: charge,
      p_lease_seconds: FREE_LEASE_SECONDS,
    });
    if (!id) throw new SpeechError(NO_CREDIT, 402);
    return id;
  }

  async commit(id: string): Promise<void> {
    if (id) await this.rpc('translation_settle', { p_id: id, p_charged: true });
  }
  async refund(id: string): Promise<void> {
    if (id) await this.rpc('translation_settle', { p_id: id, p_charged: false });
  }

  /** Whether this host can pay for translation in this meeting right now. */
  async funded(by: string, resource: string): Promise<boolean> {
    if (await this.isAdmin(by)) return true;
    try {
      await this.require(by, resource);
      return true;
    } catch (error) {
      if (error instanceof SpeechError && error.status === 402) return false;
      throw error;
    }
  }

  /** What the host sees: credit, expiry and free meetings left today. */
  async access(by: string): Promise<{
    balanceMicros: number;
    expires: string | null;
    freeLeft: number;
    freeLimit: number;
  }> {
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: wallet }, { data: daily }] = await Promise.all([
      this.db
        .from('translation_wallets')
        .select('balance_micros, expires_at')
        .eq('user_id', by)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle(),
      this.db
        .from('translation_free_days')
        .select('uses')
        .eq('user_id', by)
        .eq('day', today)
        .maybeSingle(),
    ]);
    return {
      balanceMicros: Number(wallet?.balance_micros ?? 0),
      expires: wallet?.expires_at ?? null,
      freeLeft: Math.max(0, FREE_MEETINGS_PER_DAY - Number(daily?.uses ?? 0)),
      freeLimit: FREE_MEETINGS_PER_DAY,
    };
  }
}
