import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpcomingMeetings } from './UpcomingMeetings';

const meeting = {
  id: 'meeting-1',
  title: 'Weekly Team Sync',
  description: null,
  scheduled_at: '2026-08-14T17:00:00.000Z',
  duration_minutes: 60,
  join_code: '8523BF',
  status: 'pending',
  invitee_count: 1,
  invitees: [
    {
      id: 'invitee-1',
      email: 'guest@example.com',
      name: null,
      rsvp_status: 'accepted',
    },
  ],
};

function response(body: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

async function renderMeetings() {
  render(<UpcomingMeetings onSchedule={vi.fn()} />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe('UpcomingMeetings', () => {
  const originalLocation = window.location;
  let navigations: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Starting a meeting navigates twice: once at pairux://, once at the web
    // player if nothing answers. jsdom implements neither, so record both.
    navigations = [];
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() {
          return navigations[navigations.length - 1] ?? '';
        },
        set href(value: string) {
          navigations.push(value);
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  async function startMeeting() {
    vi.setSystemTime('2026-08-14T17:30:00.000Z');
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ data: [meeting] }))
      .mockResolvedValueOnce(
        response({
          data: {
            session: { id: 'session-1', join_code: '8523BF' },
            joinCode: '8523BF',
            resumed: false,
            notified: 2,
          },
        })
      );

    await renderMeetings();
    fireEvent.click(screen.getByRole('button', { name: 'Start Now' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('says Start Early before the booked time and Start Now once it arrives', async () => {
    vi.setSystemTime('2026-08-14T16:59:45.000Z');
    vi.mocked(fetch).mockResolvedValue(response({ data: [meeting] }));

    await renderMeetings();

    // Startable either way — early is a label, not a lock — and the join code
    // stays on the row whichever it says.
    expect(screen.getByRole('button', { name: 'Start Early' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '8523BF' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByRole('button', { name: 'Start Now' })).toBeInTheDocument();
  });

  it('keeps a meeting startable hours after it should have ended', async () => {
    // Three hours past a one-hour meeting: a host running late, which is the
    // normal case rather than a meeting that no longer exists.
    vi.setSystemTime('2026-08-14T20:00:00.000Z');
    vi.mocked(fetch).mockResolvedValue(response({ data: [meeting] }));

    await renderMeetings();

    expect(screen.getByText('Weekly Team Sync')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Now' })).toBeInTheDocument();
  });

  it('removes a meeting once its late grace is spent', async () => {
    // Booked to end at 18:00, so it lapses twelve hours later at 06:00.
    vi.setSystemTime('2026-08-15T06:01:00.000Z');
    vi.mocked(fetch).mockResolvedValue(response({ data: [meeting] }));

    await renderMeetings();

    expect(screen.queryByText('Weekly Team Sync')).not.toBeInTheDocument();
    expect(screen.getByText('No upcoming meetings scheduled')).toBeInTheDocument();
  });

  it('shows the server error when starting a meeting fails', async () => {
    vi.setSystemTime('2026-08-14T17:30:00.000Z');
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ data: [meeting] }))
      .mockResolvedValueOnce(response({ error: 'Join code already in use' }, false));

    await renderMeetings();
    fireEvent.click(screen.getByRole('button', { name: 'Start Now' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Join code already in use');
    // Started through the meeting, not through a bare session create: that is
    // what ties the room to the meeting and mails the guest list.
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/scheduled-sessions/meeting-1/start',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('offers the started meeting to the desktop app first', async () => {
    await startMeeting();

    expect(navigations).toEqual(['pairux://host/session-1']);
    expect(screen.getByText('Opening the PairUX desktop app…')).toBeInTheDocument();
  });

  it('falls back to the web player when the desktop app does not answer', async () => {
    await startMeeting();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(navigations).toEqual(['pairux://host/session-1', '/host/session-1']);
  });

  it('lets the host bail out to this browser without waiting', async () => {
    await startMeeting();

    fireEvent.click(screen.getByRole('button', { name: 'Continue in this browser' }));

    expect(navigations).toEqual(['pairux://host/session-1', '/host/session-1']);
  });
});
