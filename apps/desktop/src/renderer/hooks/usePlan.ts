/**
 * Reads the current user's billing plan for the paid multistream plugin.
 *
 * Free plan can stream to YouTube only; pro/team unlock every platform.
 * The main process is the source of truth (see main/billing/entitlement.ts);
 * this hook is for UI affordances (lock badges, upgrade prompts) only — the
 * real gate is enforced in the main process.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Plan } from '@pairux/shared-types';
import { getElectronAPI, isElectron } from '@/lib/ipc';

interface UsePlanResult {
  plan: Plan;
  paidUnlocked: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function usePlan(): UsePlanResult {
  const [plan, setPlan] = useState<Plan>('free');
  const [paidUnlocked, setPaidUnlocked] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isElectron()) return;
    try {
      const result = await getElectronAPI().invoke('billing:getPlan', { forceRefresh: true });
      setPlan(result.plan);
      setPaidUnlocked(result.paidUnlocked);
    } catch (err) {
      console.error('[usePlan] Failed to load plan:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { plan, paidUnlocked, isLoading, refresh };
}
