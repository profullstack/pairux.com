'use client';

import { useEffect, useState } from 'react';
import type { SessionParticipant } from '@pairux/shared-types';
import { nextPlan, planForCap } from '@/lib/plans';
import { UpgradePrompt } from './UpgradePrompt';

/** How often the host page re-reads the room for turned-away joiners. */
const REFUSAL_POLL_MS = 30_000;

interface HostCapPromptProps {
  sessionId: string;
  /** settings.maxParticipants: the owner's plan cap, baked in at creation. */
  cap: number | undefined;
  /** Live participant rows (the host page's realtime list). */
  participants: SessionParticipant[];
  /** settings.capRefusedCount as of page load. */
  initialRefused?: number | undefined;
}

interface SessionResponse {
  data?: { settings?: { capRefusedCount?: number; maxParticipants?: number } };
}

/**
 * Upgrade prompt for the HOST when their room hits its plan cap: either every
 * signed-in seat is taken (the same count join_session enforces: signed-in,
 * not left; guests are unlimited and never count), or a joiner was turned
 * away (the join/token routes bump settings.capRefusedCount).
 */
export function HostCapPrompt({
  sessionId,
  cap,
  participants,
  initialRefused,
}: HostCapPromptProps) {
  const [refused, setRefused] = useState(initialRefused ?? 0);
  const [roomCap, setRoomCap] = useState(cap);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // Poll for refusals: they leave no participant row, so realtime can't see them.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) return;
        const body = (await res.json()) as SessionResponse;
        const settings = body.data?.settings;
        if (cancelled || !settings) return;
        setRefused(settings.capRefusedCount ?? 0);
        if (typeof settings.maxParticipants === 'number') setRoomCap(settings.maxParticipants);
      } catch {
        // Best effort: the occupancy check below still works.
      }
    };
    const timer = setInterval(() => void poll(), REFUSAL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId]);

  if (!roomCap) return null;
  const currentPlan = planForCap(roomCap);
  const upgrade = nextPlan(currentPlan);
  if (!upgrade) return null;

  const occupied = participants.filter((p) => p.user_id && !p.left_at).length;
  const atCap = occupied >= roomCap;
  // A dismissal holds until someone new is turned away.
  const dismissed = dismissedAt !== null && refused <= dismissedAt;
  if ((!atCap && refused === 0) || dismissed) return null;

  return (
    <div className="fixed right-4 bottom-4 z-40 w-[min(26rem,calc(100vw-2rem))]">
      <UpgradePrompt
        reason="roomFull"
        plan={upgrade}
        currentPlan={currentPlan}
        cap={roomCap}
        refused={refused}
        returnTo={`/host/${sessionId}`}
        onDismiss={() => {
          setDismissedAt(refused);
        }}
        tone="dark"
      />
    </div>
  );
}
