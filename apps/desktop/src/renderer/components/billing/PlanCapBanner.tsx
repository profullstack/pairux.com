import { useState } from 'react';
import { Users, X } from 'lucide-react';
import type { SessionParticipant } from '@pairux/shared-types';
import { LISTENER_CAP, PLAN_PRICE_USD, nextPlan, planForCap } from '@pairux/shared-types';
import { Button } from '@/components/ui/button';
import { getElectronAPI, isElectron } from '@/lib/ipc';

const PLAN_NAME = { free: 'Free', plus: 'Plus', pro: 'Pro', team: 'Team' } as const;

interface PlanCapBannerProps {
  /** settings.maxParticipants: the owner's plan cap, baked in at creation. */
  cap: number | undefined;
  /** The room's participant rows (guests have no user_id and never count). */
  participants: SessionParticipant[];
}

/**
 * Host-only upgrade prompt when every signed-in seat in the room is taken: the
 * next joiner will be turned away. Names the limit, the plan that lifts it and
 * its price; the button opens /upgrade/<plan>, which starts the CoinPay
 * checkout straight away. Mirrors the web HostCapPrompt.
 */
export function PlanCapBanner({ cap, participants }: PlanCapBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (!cap || dismissed) return null;

  const current = planForCap(cap);
  const upgrade = nextPlan(current);
  if (!upgrade) return null;

  const occupied = participants.filter((p) => p.user_id && !p.left_at).length;
  if (occupied < cap) return null;

  const openUpgrade = () => {
    if (!isElectron()) return;
    void getElectronAPI().invoke('auth:openExternal', `/upgrade/${upgrade}`);
  };

  return (
    <div
      role="alert"
      data-testid="plan-cap-banner"
      className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm font-medium">Your room is full</p>
          <p className="text-xs text-muted-foreground">
            All {cap} seats on your {PLAN_NAME[current]} plan are taken, so the next person to join
            will be turned away. {PLAN_NAME[upgrade]} raises it to {LISTENER_CAP[upgrade]} listeners
            for ${PLAN_PRICE_USD[upgrade]}/month.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" onClick={openUpgrade}>
          Upgrade to {PLAN_NAME[upgrade]}: ${PLAN_PRICE_USD[upgrade]}/mo
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Not now"
          onClick={() => {
            setDismissed(true);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
