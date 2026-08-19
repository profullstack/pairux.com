import { describe, it, expect } from 'vitest';
import { applyHostControlIntent, isGrantedController } from './controlIntent';

interface Row {
  id: string;
  user_id?: string | null;
  role?: string | null;
  control_state?: string | null;
  display_name?: string;
}

const guest = (over: Partial<Row> = {}): Row => ({
  id: 'participant-1',
  user_id: 'user-1',
  role: 'participant',
  control_state: 'view-only',
  display_name: 'Guest',
  ...over,
});

const host = (over: Partial<Row> = {}): Row => ({
  id: 'participant-host',
  user_id: 'user-host',
  role: 'host',
  control_state: 'granted',
  display_name: 'Host',
  ...over,
});

describe('isGrantedController', () => {
  it('matches a grant stored under the user id', () => {
    expect(isGrantedController(guest(), 'user-1')).toBe(true);
  });

  it('matches a grant stored under the participant row id', () => {
    expect(isGrantedController(guest(), 'participant-1')).toBe(true);
  });

  it('does not match an unrelated viewer', () => {
    expect(isGrantedController(guest(), 'user-2')).toBe(false);
  });

  it('treats no grant as nobody controlling', () => {
    expect(isGrantedController(guest({ control_state: 'granted' }), null)).toBe(false);
  });
});

describe('applyHostControlIntent', () => {
  /**
   * The reported bug: the host revokes, injection stops immediately, but the
   * next poll response still carries `granted` and the badge says the guest is
   * driving. Host intent has to win.
   */
  it('clears a stale granted state after the host has revoked', () => {
    const rows = [guest({ control_state: 'granted' })];

    const [adjusted] = applyHostControlIntent(rows, null);

    expect(adjusted.control_state).toBe('view-only');
  });

  it('shows the grant before the poll has caught up with it', () => {
    const rows = [guest({ control_state: 'view-only' })];

    const [adjusted] = applyHostControlIntent(rows, 'user-1');

    expect(adjusted.control_state).toBe('granted');
  });

  it('downgrades everyone except the viewer the host actually granted', () => {
    const rows = [
      guest({ id: 'p1', user_id: 'user-1', control_state: 'granted' }),
      guest({ id: 'p2', user_id: 'user-2', control_state: 'granted' }),
    ];

    const adjusted = applyHostControlIntent(rows, 'user-2');

    expect(adjusted.map((row) => row.control_state)).toEqual(['view-only', 'granted']);
  });

  it("never rewrites the host's own row", () => {
    // The host row is seeded `granted` because they control their own machine.
    // Downgrading it would make the session look uncontrolled to its owner.
    const rows = [host(), guest({ control_state: 'granted' })];

    const adjusted = applyHostControlIntent(rows, null);

    expect(adjusted[0].control_state).toBe('granted');
    expect(adjusted[1].control_state).toBe('view-only');
  });

  it('leaves an unanswered request pending', () => {
    const rows = [guest({ control_state: 'requested' })];

    const adjusted = applyHostControlIntent(rows, null);

    expect(adjusted[0].control_state).toBe('requested');
  });

  it('preserves every other field', () => {
    const rows = [guest({ control_state: 'granted', display_name: 'Preshy' })];

    const [adjusted] = applyHostControlIntent(rows, null);

    expect(adjusted.display_name).toBe('Preshy');
    expect(adjusted.id).toBe('participant-1');
    expect(adjusted.user_id).toBe('user-1');
  });

  it('returns rows untouched when nothing needs adjusting', () => {
    const rows = [guest({ control_state: 'view-only' })];

    const adjusted = applyHostControlIntent(rows, null);

    // Identity, not just equality — an unnecessary new object re-renders the
    // participant list on every one of the 5-second polls.
    expect(adjusted[0]).toBe(rows[0]);
  });

  it('matches a guest whose grant was stored under the participant row id', () => {
    // Anonymous guests have no user_id to grant against.
    const rows = [guest({ user_id: null, control_state: 'view-only' })];

    const [adjusted] = applyHostControlIntent(rows, 'participant-1');

    expect(adjusted.control_state).toBe('granted');
  });
});
