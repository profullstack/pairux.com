'use client';

import { useEffect, useState } from 'react';
import type { Plan, SeatKind, SessionParticipant } from '@pairux/shared-types';
import { maxListeners, seatUsage } from '@pairux/shared-types';
import { nextPlan, planForCap } from '@/lib/plans';
import { UpgradePrompt } from './UpgradePrompt';

/** How often the host page re-reads the room for turned-away joiners. */
const REFUSAL_POLL_MS = 30_000;

interface HostCapPromptProps {
  sessionId: string;
  /** The room owner: their seat is always counted, never by row. */
  hostUserId: string | null | undefined;
  /** 'p2p' or 'sfu': decides whether an anonymous guest is a participant or a listener. */
  mode: string | null | undefined;
  /** settings.maxParticipants: the owner's participant cap (host included). */
  cap: number | undefined;
  /** settings.maxListeners: the owner's listener cap. */
  listenerCap?: number | undefined;
  /** Live participant rows (the host page's realtime list). */
  participants: SessionParticipant[];
  /** settings.capRefusedCount as of page load. */
  initialRefused?: number | undefined;
  /** settings.capRefusedKind as of page load. */
  initialRefusedKind?: SeatKind | undefined;
}

interface RoomCapacity {
  plan: Plan;
  participant_cap: number;
  listener_cap: number;
  participants: number;
  listeners: number;
}

interface SessionResponse {
  data?: {
    settings?: {
      capRefusedCount?: number;
      capRefusedKind?: SeatKind;
      maxParticipants?: number;
    };
    capacity?: RoomCapacity;
  };
}

/**
 * Upgrade prompt for the HOST when their room hits its plan cap: every
 * participant seat is taken (Free: the host + 1, counted the way join_session
 * counts: signed-in joiners and P2P guests who are still here), every listener
 * seat is taken (anonymous SFU guests), or a joiner was turned away (the
 * join/token routes bump settings.capRefusedCount).
 */
export function HostCapPrompt({
  sessionId,
  hostUserId,
  mode,
  cap,
  listenerCap,
  participants,
  initialRefused,
  initialRefusedKind,
}: HostCapPromptProps) {
  const [refused, setRefused] = useState(initialRefused ?? 0);
  const [refusedKind, setRefusedKind] = useState<SeatKind>(initialRefusedKind ?? 'participants');
  const [capacity, setCapacity] = useState<RoomCapacity | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // Re-render on the poll so rows that went quiet stop counting.
  const [now, setNow] = useState(() => Date.now());

  // Poll for refusals (they leave no participant row, so realtime can't see
  // them) and for the room's caps on the owner's current plan.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) return;
        const body = (await res.json()) as SessionResponse;
        if (cancelled || !body.data) return;
        const settings = body.data.settings;
        if (settings) {
          setRefused(settings.capRefusedCount ?? 0);
          if (settings.capRefusedKind) setRefusedKind(settings.capRefusedKind);
        }
        if (body.data.capacity) setCapacity(body.data.capacity);
      } catch {
        // Best effort: the occupancy check below still works.
      } finally {
        if (!cancelled) setNow(Date.now());
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), REFUSAL_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId]);

  const participantCapNow = capacity?.participant_cap ?? cap;
  if (!participantCapNow) return null;
  const currentPlan = capacity?.plan ?? planForCap(participantCapNow);
  const upgrade = nextPlan(currentPlan);
  if (!upgrade) return null;
  const listenerCapNow = capacity?.listener_cap ?? listenerCap ?? maxListeners(currentPlan);

  // The realtime rows are the quickest signal; the server's count covers rows
  // this page has not heard about yet.
  const usage = seatUsage(participants, { hostUserId, mode }, now);
  const participantsNow = Math.max(usage.participants, capacity?.participants ?? 0);
  const listenersNow = Math.max(usage.listeners, capacity?.listeners ?? 0);
  const participantsFull = participantsNow >= participantCapNow;
  const listenersFull = listenersNow >= listenerCapNow;

  // A dismissal holds until someone new is turned away.
  const dismissed = dismissedAt !== null && refused <= dismissedAt;
  if ((!participantsFull && !listenersFull && refused === 0) || dismissed) return null;

  const seats: SeatKind = participantsFull
    ? 'participants'
    : listenersFull
      ? 'listeners'
      : refusedKind;

  return (
    <div className="fixed right-4 bottom-4 z-40 w-[min(26rem,calc(100vw-2rem))]">
      <UpgradePrompt
        reason="roomFull"
        plan={upgrade}
        currentPlan={currentPlan}
        seats={seats}
        cap={seats === 'participants' ? participantCapNow : listenerCapNow}
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
