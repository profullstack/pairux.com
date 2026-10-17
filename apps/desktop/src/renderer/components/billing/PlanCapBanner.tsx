import { useEffect, useState } from 'react';
import { Users, X } from 'lucide-react';
import type { SessionParticipant } from '@pairux/shared-types';
import {
  LISTENER_CAP,
  PARTICIPANT_CAP,
  PLAN_PRICE_USD,
  maxListeners,
  nextPlan,
  planForCap,
  seatUsage,
} from '@pairux/shared-types';
import { Button } from '@/components/ui/button';
import { getElectronAPI, isElectron } from '@/lib/ipc';

const PLAN_NAME = { free: 'Free', plus: 'Plus', pro: 'Pro', team: 'Team' } as const;

/** Re-count every 30 s so rows that went quiet stop holding a seat. */
const RECOUNT_MS = 30_000;

interface PlanCapBannerProps {
  /** settings.maxParticipants: the owner's participant cap, the host included. */
  cap: number | undefined;
  /** settings.maxListeners: the owner's listener cap. */
  listenerCap?: number | undefined;
  /** The room owner: their seat always counts, never by row. */
  hostUserId: string | null | undefined;
  /** 'p2p' or 'sfu': an anonymous guest is a participant in P2P, a listener in SFU. */
  mode: string | null | undefined;
  participants: SessionParticipant[];
}

/**
 * Host-only upgrade prompt when every seat of a kind is taken, so the next
 * joiner of that kind will be turned away: participants (Free: you + 1, the
 * signed-in joiners and P2P guests still here) or listeners (anonymous SFU
 * guests; Free: 20). Names the limit, the plan that lifts it and its price; the
 * button opens /upgrade/<plan>, which starts the CoinPay checkout straight
 * away. Mirrors the web HostCapPrompt.
 */
export function PlanCapBanner({
  cap,
  listenerCap,
  hostUserId,
  mode,
  participants,
}: PlanCapBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, RECOUNT_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (!cap || dismissed) return null;

  const current = planForCap(cap);
  const upgrade = nextPlan(current);
  if (!upgrade) return null;

  const usage = seatUsage(participants, { hostUserId, mode }, now);
  const listeners = listenerCap ?? maxListeners(current);
  const participantsFull = usage.participants >= cap;
  const listenersFull = usage.listeners >= listeners;
  if (!participantsFull && !listenersFull) return null;

  const openUpgrade = () => {
    if (!isElectron()) return;
    void getElectronAPI().invoke('auth:openExternal', `/upgrade/${upgrade}`);
  };

  const detail = participantsFull
    ? `Your ${PLAN_NAME[current]} plan allows ${String(cap)} participants, you included, and every seat is taken, so the next person to join will be turned away. ${PLAN_NAME[upgrade]} raises it to ${String(PARTICIPANT_CAP[upgrade])} participants for $${String(PLAN_PRICE_USD[upgrade])}/month.`
    : `All ${String(listeners)} listener seats on your ${PLAN_NAME[current]} plan are taken, so the next guest will be turned away. ${PLAN_NAME[upgrade]} raises it to ${String(LISTENER_CAP[upgrade])} listeners for $${String(PLAN_PRICE_USD[upgrade])}/month.`;

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
          <p className="text-xs text-muted-foreground">{detail}</p>
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
