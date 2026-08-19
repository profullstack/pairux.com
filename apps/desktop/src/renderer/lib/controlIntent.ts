/**
 * Reconciling what the host decided about control with what the database says.
 *
 * Two things track who is driving the host's machine, and only one of them is
 * a decision. `grantedViewerId` is the host's own record of who they handed
 * control to, and it is what gates OS input injection. The participant list is
 * a 5-second poll of the database — an echo, and an eventually consistent one.
 *
 * Rendering control state straight off that poll is what produced "when I took
 * control back from my pair, PairUX said my pair still had control": a poll
 * response already in flight when the host revokes lands afterwards still
 * carrying `granted`, and the UI re-asserts a grant that injection has already
 * stopped honouring. The same race in the other direction was noted in the
 * capture view long ago, where it briefly switched injection back off.
 *
 * So the poll supplies everything about a participant except this one field,
 * which host intent overrides.
 */

/** The subset of a participant this module needs. */
export interface ControllableParticipant {
  id: string;
  user_id?: string | null;
  role?: string | null;
  control_state?: string | null;
}

/**
 * Whether a participant is the one the host granted control to.
 *
 * A grant is stored under whichever id resolved to a live viewer at the time —
 * `user_id` for a signed-in participant, the participant row id for an
 * anonymous guest — so both have to be considered here. Matching only one of
 * them is how a viewer that reconnected mid-session stopped matching its own
 * grant.
 */
export function isGrantedController(
  participant: ControllableParticipant,
  grantedViewerId: string | null
): boolean {
  if (grantedViewerId === null) return false;
  return participant.user_id === grantedViewerId || participant.id === grantedViewerId;
}

/**
 * Rewrite `control_state` across the participant list to match host intent.
 *
 * The host's own row is left alone: it is created with `granted` because the
 * host always controls their own machine, and that is not a grant to anybody.
 * `requested` is also left alone — those are live, unanswered asks, and the
 * host has not decided about them yet.
 */
export function applyHostControlIntent<T extends ControllableParticipant>(
  participants: readonly T[],
  grantedViewerId: string | null
): T[] {
  return participants.map((participant) => {
    if (participant.role === 'host') return participant;

    if (isGrantedController(participant, grantedViewerId)) {
      return participant.control_state === 'granted'
        ? participant
        : { ...participant, control_state: 'granted' };
    }

    // Not the controller. A lingering `granted` here is stale by definition:
    // the host has since revoked it or handed control to somebody else.
    return participant.control_state === 'granted'
      ? { ...participant, control_state: 'view-only' }
      : participant;
  });
}
