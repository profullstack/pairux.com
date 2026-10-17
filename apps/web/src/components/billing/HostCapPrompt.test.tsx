import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionParticipant } from '@pairux/shared-types';
import { render, screen, fireEvent, waitFor } from '@/test/intl';
import { HostCapPrompt } from './HostCapPrompt';

function seat(id: string, userId: string | null): SessionParticipant {
  return {
    id,
    session_id: 's1',
    user_id: userId,
    display_name: id,
    role: 'viewer',
    control_state: 'view-only',
    joined_at: '2026-10-17T00:00:00Z',
    left_at: null,
  } as unknown as SessionParticipant;
}

const signedIn = (n: number) =>
  Array.from({ length: n }, (_, i) => seat(`p${String(i)}`, `u${String(i)}`));

describe('HostCapPrompt', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays hidden while there are free seats (guests never count)', () => {
    const participants = [...signedIn(19), seat('g1', null), seat('g2', null)];
    render(<HostCapPrompt sessionId="s1" cap={20} participants={participants} />);
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });

  it('names the limit, the plan that lifts it and its price when the room is full', () => {
    render(<HostCapPrompt sessionId="s1" cap={20} participants={signedIn(20)} />);
    const prompt = screen.getByTestId('upgrade-prompt');
    expect(prompt.textContent).toContain('Your room is full');
    expect(prompt.textContent).toContain('All 20 seats on your Free plan are taken.');
    expect(prompt.textContent).toContain('Plus raises it to 100 listeners for $1/month.');
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe('Upgrade to Plus: $1/mo');
  });

  it('shows after a refusal even when the room has since emptied', () => {
    render(<HostCapPrompt sessionId="s1" cap={20} participants={signedIn(3)} initialRefused={2} />);
    expect(screen.getByTestId('upgrade-prompt').textContent).toContain(
      '2 people were turned away.'
    );
  });

  it('offers Pro to a full Plus room and nothing to a Team room', () => {
    const { unmount } = render(
      <HostCapPrompt sessionId="s1" cap={100} participants={signedIn(100)} />
    );
    expect(screen.getByTestId('upgrade-prompt-cta').textContent).toBe('Upgrade to Pro: $12/mo');
    unmount();
    render(<HostCapPrompt sessionId="s1" cap={2000} participants={signedIn(2000)} />);
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

    render(<HostCapPrompt sessionId="s1" cap={20} participants={signedIn(20)} />);
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
    render(<HostCapPrompt sessionId="s1" cap={20} participants={signedIn(20)} />);
    fireEvent.click(screen.getByLabelText('Not now'));
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });
});
