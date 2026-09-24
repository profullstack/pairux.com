import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScheduleMeetingModal, type EditableMeeting } from './ScheduleMeetingModal';

const meeting: EditableMeeting = {
  id: 'meeting-1',
  title: 'Weekly Sync',
  description: 'Agenda',
  scheduled_at: '2026-09-01T15:00:00.000Z',
  duration_minutes: 90,
  invitees: [{ email: 'stay@example.com' }, { email: 'drop@example.com' }],
};

const CHANNELS = [
  { id: 'chan-mine', handle: 'moshcoding', name: 'Mosh Coding', org_name: null, team_name: null },
  {
    id: 'chan-team',
    handle: 'profullstack',
    name: 'Profullstack',
    org_name: 'Profullstack, Inc.',
    team_name: 'Engineering',
  },
];

/** Answers the modal's channel list, and every save with success. */
function mockFetchOk(channels: unknown[] = CHANNELS) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(
          url === '/api/channels' ? { data: { channels } } : { data: { id: 'meeting-1' } }
        ),
    })
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** The save request — the first call that is not the channel list. */
function saveCall(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.find((c) => c[0] !== '/api/channels') as
    | [string, { method: string; body: string }]
    | undefined;
}

function lastRequestBody(fetchMock: ReturnType<typeof vi.fn>) {
  const init = saveCall(fetchMock)?.[1];
  return JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
}

describe('ScheduleMeetingModal — edit mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the existing meeting details and invitees', () => {
    mockFetchOk();
    render(<ScheduleMeetingModal meeting={meeting} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByRole('heading', { name: /edit meeting/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Weekly Sync')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Agenda')).toBeInTheDocument();
    expect(screen.getByDisplayValue('stay@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('drop@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('keeps a non-standard duration selectable', () => {
    mockFetchOk();
    render(
      <ScheduleMeetingModal
        meeting={{ ...meeting, duration_minutes: 75 }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/duration/i)).toHaveValue('75');
  });

  it('PATCHes the meeting, preserving the scheduled instant', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();
    const onSaved = vi.fn();

    render(<ScheduleMeetingModal meeting={meeting} onClose={vi.fn()} onSaved={onSaved} />);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });

    const [url, init] = saveCall(fetchMock) ?? ['', { method: '', body: '' }];
    expect(url).toBe('/api/scheduled-sessions/meeting-1');
    expect(init.method).toBe('PATCH');

    const body = lastRequestBody(fetchMock);
    expect(body.title).toBe('Weekly Sync');
    expect(body.durationMinutes).toBe(90);
    // The datetime-local round-trip goes through local time — same instant either way.
    expect(new Date(body.scheduledAt as string).getTime()).toBe(
      new Date(meeting.scheduled_at).getTime()
    );
    expect(body.inviteeEmails).toEqual(['stay@example.com', 'drop@example.com']);
    expect(onSaved).toHaveBeenCalled();
  });

  it('sends the shortened list when an invitee is removed', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();

    render(<ScheduleMeetingModal meeting={meeting} onClose={vi.fn()} onSaved={vi.fn()} />);

    const removeButtons = screen
      .getAllByRole('button')
      .filter((b) => b.className.includes('hover:text-red-500'));
    await user.click(removeButtons[1]!);

    expect(screen.queryByDisplayValue('drop@example.com')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });

    expect(lastRequestBody(fetchMock).inviteeEmails).toEqual(['stay@example.com']);
  });

  it('sends an empty list when every invitee is removed', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();

    render(<ScheduleMeetingModal meeting={meeting} onClose={vi.fn()} onSaved={vi.fn()} />);

    for (const email of ['drop@example.com', 'stay@example.com']) {
      const row = screen.getByDisplayValue(email).parentElement!;
      const remove = row.querySelector('button');
      await user.click(remove as HTMLElement);
    }

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });

    expect(lastRequestBody(fetchMock).inviteeEmails).toEqual([]);
  });

  it('adds a new invitee to the list', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();

    render(<ScheduleMeetingModal meeting={meeting} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /add another/i }));
    const blankInput = screen
      .getAllByPlaceholderText('colleague@example.com')
      .find((i) => (i as HTMLInputElement).value === '');
    await user.type(blankInput!, 'New@Example.com');

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });

    expect(lastRequestBody(fetchMock).inviteeEmails).toEqual([
      'stay@example.com',
      'drop@example.com',
      'new@example.com',
    ]);
  });

  it('surfaces a server error without closing', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'This meeting has been cancelled' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onSaved = vi.fn();

    render(<ScheduleMeetingModal meeting={meeting} onClose={vi.fn()} onSaved={onSaved} />);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('This meeting has been cancelled')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('ScheduleMeetingModal — create mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('still POSTs a new meeting', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();

    render(<ScheduleMeetingModal onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByRole('heading', { name: /schedule meeting/i })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('e.g. Weekly Team Sync'), 'New Meeting');
    await user.click(screen.getByRole('button', { name: /schedule meeting/i }));

    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });

    const [url, init] = saveCall(fetchMock) ?? ['', { method: '', body: '' }];
    expect(url).toBe('/api/scheduled-sessions');
    expect(init.method).toBe('POST');
    expect(lastRequestBody(fetchMock).inviteeEmails).toBeUndefined();
  });

  it('sends no recurrence for a one-off meeting', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();

    render(<ScheduleMeetingModal onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('e.g. Weekly Team Sync'), 'One Off');
    await user.click(screen.getByRole('button', { name: /schedule meeting/i }));

    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });

    const body = lastRequestBody(fetchMock);
    expect(body.recurrenceFreq).toBeUndefined();
    expect(body.recurrenceInterval).toBeUndefined();
  });

  it('hides the repeat detail fields until a frequency is chosen', async () => {
    const user = userEvent.setup();
    mockFetchOk();

    render(<ScheduleMeetingModal onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByLabelText(/number of times/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/repeat/i), 'weekly');
    expect(screen.getByLabelText(/number of times/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^every$/i)).toHaveValue(1);
  });

  it('POSTs the chosen recurrence', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();

    render(<ScheduleMeetingModal onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('e.g. Weekly Team Sync'), 'Standup');
    await user.selectOptions(screen.getByLabelText(/repeat/i), 'daily');

    const interval = screen.getByLabelText(/^every$/i);
    await user.clear(interval);
    await user.type(interval, '2');

    const count = screen.getByLabelText(/number of times/i);
    await user.clear(count);
    await user.type(count, '10');

    await user.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });

    const body = lastRequestBody(fetchMock);
    expect(body.recurrenceFreq).toBe('daily');
    expect(body.recurrenceInterval).toBe(2);
    expect(body.recurrenceCount).toBe(10);
  });

  it('treats a count of 0 as repeating forever', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();

    render(<ScheduleMeetingModal onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('e.g. Weekly Team Sync'), 'Forever');
    await user.selectOptions(screen.getByLabelText(/repeat/i), 'weekly');

    expect(screen.getByLabelText(/number of times/i)).toHaveValue(0);
    expect(screen.getByText('0 = forever')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /schedule meeting/i }));
    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });

    expect(lastRequestBody(fetchMock).recurrenceCount).toBe(0);
  });
});

describe('ScheduleMeetingModal — editing a series', () => {
  const series: EditableMeeting = {
    ...meeting,
    recurrence_freq: 'weekly',
    recurrence_interval: 2,
    recurrence_count: 8,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefills the existing recurrence', () => {
    mockFetchOk();
    render(<ScheduleMeetingModal meeting={series} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByLabelText(/repeat/i)).toHaveValue('weekly');
    expect(screen.getByLabelText(/^every$/i)).toHaveValue(2);
    expect(screen.getByLabelText(/number of times/i)).toHaveValue(8);
  });

  it('sends a null frequency when the series is turned off, so it actually clears', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();

    render(<ScheduleMeetingModal meeting={series} onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText(/repeat/i), '');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });

    const body = lastRequestBody(fetchMock);
    expect(body.recurrenceFreq).toBeNull();
    expect('recurrenceInterval' in body).toBe(false);
  });
});

describe('ScheduleMeetingModal — broadcast channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists my channels and my team channels, grouped by owner', async () => {
    mockFetchOk();
    render(<ScheduleMeetingModal onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(
      await screen.findByRole('option', { name: 'Mosh Coding (@moshcoding)' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Profullstack (@profullstack)' })
    ).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Your channels' })).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Profullstack, Inc. · Engineering' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/broadcast channel/i)).toHaveValue('');
  });

  it('schedules a meeting on the chosen channel', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();

    render(<ScheduleMeetingModal onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByRole('option', { name: 'Profullstack (@profullstack)' });
    await user.type(screen.getByPlaceholderText('e.g. Weekly Team Sync'), 'Team Standup');
    await user.selectOptions(screen.getByLabelText(/broadcast channel/i), 'chan-team');
    await user.click(screen.getByRole('button', { name: /schedule meeting/i }));

    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });
    expect(lastRequestBody(fetchMock).channelId).toBe('chan-team');
  });

  it('sends no channel for a new private meeting', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();

    render(<ScheduleMeetingModal onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('e.g. Weekly Team Sync'), 'Private');
    await user.click(screen.getByRole('button', { name: /schedule meeting/i }));

    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });
    expect('channelId' in lastRequestBody(fetchMock)).toBe(false);
  });

  it('prefills the meeting channel and sends null when it is taken off', async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchOk();

    render(
      <ScheduleMeetingModal
        meeting={{ ...meeting, channel_id: 'chan-mine' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await screen.findByRole('option', { name: 'Mosh Coding (@moshcoding)' });
    expect(screen.getByLabelText(/broadcast channel/i)).toHaveValue('chan-mine');

    await user.selectOptions(screen.getByLabelText(/broadcast channel/i), '');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(saveCall(fetchMock)).toBeDefined();
    });
    expect(lastRequestBody(fetchMock).channelId).toBeNull();
  });

  it('keeps showing a channel the host no longer has access to', async () => {
    mockFetchOk([]);
    render(
      <ScheduleMeetingModal
        meeting={{ ...meeting, channel_id: 'chan-gone' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(
      await screen.findByRole('option', { name: /no longer have access/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/broadcast channel/i)).toHaveValue('chan-gone');
  });
});
