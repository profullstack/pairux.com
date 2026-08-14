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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals Start Now when an open dashboard crosses the early-start boundary', async () => {
    vi.setSystemTime('2026-08-14T16:44:59.000Z');
    vi.mocked(fetch).mockResolvedValue(response({ data: [meeting] }));

    await renderMeetings();

    expect(screen.getByRole('link', { name: '8523BF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Now' })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByRole('button', { name: 'Start Now' })).toBeInTheDocument();
  });

  it('keeps an overdue meeting startable until its scheduled end', async () => {
    vi.setSystemTime('2026-08-14T17:30:00.000Z');
    vi.mocked(fetch).mockResolvedValue(response({ data: [meeting] }));

    await renderMeetings();

    expect(screen.getByRole('button', { name: 'Start Now' })).toBeInTheDocument();
    expect(screen.getByText(/Today at/)).toBeInTheDocument();
  });

  it('removes a meeting from the upcoming list when its duration ends', async () => {
    vi.setSystemTime('2026-08-14T17:59:45.000Z');
    vi.mocked(fetch).mockResolvedValue(response({ data: [meeting] }));

    await renderMeetings();
    expect(screen.getByText('Weekly Team Sync')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

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
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/sessions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"joinCode":"8523BF"'),
      })
    );
  });
});
