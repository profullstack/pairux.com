import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionParticipant } from '@pairux/shared-types';
import { render, screen, fireEvent, waitFor } from '@/test/intl';
import { HostCapPrompt } from './HostCapPrompt';

const HOST = 'host-user';

function seat(id: string, userId: string | null, over: Partial<SessionParticipant> = {}) {
  return {
    id,
    session_id: 's1',
    user_id: userId,
    display_name: id,
    role: 'viewer',
    control_state: 'view-only',
    joined_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    left_at: null,
    kind: 'human',
    ...over,
  } as unknown as SessionParticipant;
}

const hostRow = seat('host', HOST, { role: 'host' });
const signedIn = (n: number) =>
  Array.from({ length: n }, (_, i) => seat(`p${String(i)}`, `u${String(i)}`));
const guests = (n: number) => Array.from({ length: n }, (_, i) => seat(`g${String(i)}`, null));

/** A Free room: 2 participants (host included) + 20 listeners. */
function freeRoom(participants: SessionParticipant[], mode: 'p2p' | 'sfu' = 'p2p', extra = {}) {
  return render(
    <HostCapPrompt
      sessionId="s1"
      hostUserId={HOST}
      mode={mode}
      cap={2}
      listenerCap={20}
      participants={[hostRow, ...participants]}
      {...extra}
    />
  );
}

describe('HostCapPrompt', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays hidden while the host is alone', () => {
    freeRoom([]);
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });

  it('fires at 2 on Free: the host plus one signed-in participant', () => {
    freeRoom(signedIn(1));
    const prompt = screen.getByTestId('upgrade-prompt');
    expect(prompt.textContent).toContain('Your room is full');
    expect(prompt.textContent).toContain(
      'Your Free plan allows 2 participants, you included, and every seat is taken.'
    );
    expect(prompt.textContent).toContain('Plus raises it to 100 participants for $1/month.');
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe('Upgrade to Plus: $1/mo');
  });

  it('counts an anonymous guest in a P2P room as a participant', () => {
    freeRoom(guests(1), 'p2p');
    expect(screen.getByTestId('upgrade-prompt').textContent).toContain('2 participants');
  });

  it('counts anonymous SFU guests as listeners: hidden at 19, the listener prompt at 20', () => {
    const { unmount } = freeRoom(guests(19), 'sfu');
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
    unmount();
    freeRoom(guests(20), 'sfu');
    const prompt = screen.getByTestId('upgrade-prompt');
    expect(prompt.textContent).toContain('All 20 seats on your Free plan are taken.');
    expect(prompt.textContent).toContain('Plus raises it to 100 listeners for $1/month.');
  });

  it('ignores rows that left or went quiet, and agents', () => {
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    freeRoom([
      seat('left', 'u1', { left_at: new Date().toISOString() }),
      seat('quiet', null, { last_seen_at: stale }),
      seat('bot', null, { kind: 'agent' } as Partial<SessionParticipant>),
    ]);
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });

  it('shows after a refusal even when the room has since emptied', () => {
    freeRoom([], 'p2p', { initialRefused: 2 });
    expect(screen.getByTestId('upgrade-prompt').textContent).toContain(
      '2 people were turned away.'
    );
  });

  it('uses the caps the server reports for the owner plan right now', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: {
            settings: { capRefusedCount: 0 },
            capacity: {
              plan: 'plus',
              participant_cap: 100,
              listener_cap: 100,
              participants: 2,
              listeners: 0,
            },
          },
        }),
    });
    freeRoom(signedIn(1));
    expect(screen.getByTestId('upgrade-prompt')).toBeTruthy();
    // After the upgrade the room holds 100: the prompt goes away.
    await waitFor(() => {
      expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
    });
  });

  it('offers Pro to a full Plus room and nothing to a Team room', () => {
    const { unmount } = render(
      <HostCapPrompt
        sessionId="s1"
        hostUserId={HOST}
        mode="sfu"
        cap={100}
        participants={[hostRow, ...signedIn(99)]}
      />
    );
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe('Upgrade to Pro: $12/mo');
    unmount();
    render(
      <HostCapPrompt
        sessionId="s1"
        hostUserId={HOST}
        mode="sfu"
        cap={2000}
        participants={[hostRow, ...signedIn(1999)]}
      />
    );
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });

  it('starts the CoinPay checkout for the next plan in one click', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { checkout_url: 'https://coinpayportal.com/pay/x' } }),
    });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() {
          return 'http://localhost/host/s1';
        },
        set href(url: string) {
          assign(url);
        },
      },
    });

    freeRoom(signedIn(1));
    fireEvent.click(screen.getByTestId('upgrade-prompt-cta'));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('https://coinpayportal.com/pay/x');
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/billing/checkout',
      expect.objectContaining({ body: JSON.stringify({ plan: 'plus', currency: 'usdc_pol' }) })
    );
  });

  it('can be dismissed', () => {
    freeRoom(signedIn(1));
    fireEvent.click(screen.getByLabelText('Not now'));
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });
});
