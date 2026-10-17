import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SessionParticipant } from '@pairux/shared-types';
import { PlanCapBanner } from './PlanCapBanner';

const HOST = 'host-user';

function row(id: string, userId: string | null, over: Partial<SessionParticipant> = {}) {
  return {
    id,
    session_id: 's1',
    user_id: userId,
    display_name: id,
    role: userId === HOST ? 'host' : 'viewer',
    control_state: 'view-only',
    is_backup_host: false,
    connection_status: 'connected',
    joined_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    left_at: null,
    kind: 'human',
    ...over,
  } as SessionParticipant;
}

const host = row('host', HOST);

describe('PlanCapBanner', () => {
  it('stays hidden while the Free host is alone', () => {
    render(<PlanCapBanner cap={2} hostUserId={HOST} mode="p2p" participants={[host]} />);
    expect(screen.queryByTestId('plan-cap-banner')).toBeNull();
  });

  it('fires at 2 participants on Free, counting a P2P guest', () => {
    render(
      <PlanCapBanner cap={2} hostUserId={HOST} mode="p2p" participants={[host, row('g', null)]} />
    );
    expect(screen.getByTestId('plan-cap-banner').textContent).toContain(
      'Your Free plan allows 2 participants, you included'
    );
    expect(screen.getByText('Upgrade to Plus: $1/mo')).toBeTruthy();
  });

  it('treats SFU guests as listeners: full at 20 on Free', () => {
    const guests = Array.from({ length: 20 }, (_, i) => row(`g${String(i)}`, null));
    render(
      <PlanCapBanner
        cap={2}
        listenerCap={20}
        hostUserId={HOST}
        mode="sfu"
        participants={[host, ...guests]}
      />
    );
    expect(screen.getByTestId('plan-cap-banner').textContent).toContain(
      'All 20 listener seats on your Free plan are taken'
    );
  });

  it('does not count a guest who went quiet', () => {
    const quiet = row('g', null, { last_seen_at: new Date(Date.now() - 600_000).toISOString() });
    render(<PlanCapBanner cap={2} hostUserId={HOST} mode="p2p" participants={[host, quiet]} />);
    expect(screen.queryByTestId('plan-cap-banner')).toBeNull();
  });
});
