import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { mockUser } from '@/test/mocks/supabase';

const mockGetAuthenticatedUser = vi.fn();
const mockServiceClient = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({}),
  getAuthenticatedUser: (...args: unknown[]) => mockGetAuthenticatedUser(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  serviceClient: () => mockServiceClient(),
}));

vi.mock('@/app/actions/meetings', () => ({
  sendMeetingInvites: vi.fn(),
}));

// Advancing recurring meetings has its own tests; here it only has to be called.
const mockRollForwardHostSeries = vi.fn();
vi.mock('@/lib/recurrence-rollforward', () => ({
  rollForwardHostSeries: (...args: unknown[]) => mockRollForwardHostSeries(...args),
}));

interface ScheduledRow {
  id: string;
  scheduled_at: string;
  duration_minutes: number;
  scheduled_session_invitees: {
    id: string;
    email: string;
    name: string | null;
    rsvp_status: string;
  }[];
}

function setupList(rows: ScheduledRow[], error: { message: string } | null = null) {
  const builder: Record<string, unknown> = {};
  const gte = vi.fn(() => builder);
  const lt = vi.fn(() => builder);

  Object.assign(builder, {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    gte,
    lt,
    then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: error ? null : rows, error }).then(onFulfilled, onRejected),
  });

  mockServiceClient.mockReturnValue({ from: vi.fn(() => builder) });
  return { gte, lt };
}

function row(id: string, scheduledAt: string, durationMinutes = 60): ScheduledRow {
  return {
    id,
    scheduled_at: scheduledAt,
    duration_minutes: durationMinutes,
    scheduled_session_invitees: [
      {
        id: `${id}-invitee`,
        email: 'guest@example.com',
        name: null,
        rsvp_status: 'accepted',
      },
    ],
  };
}

describe('GET /api/scheduled-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-14T17:30:00.000Z');
    mockGetAuthenticatedUser.mockResolvedValue({ user: mockUser, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns future, running and overrunning meetings but excludes lapsed ones', async () => {
    const { gte } = setupList([
      // Yesterday's: long past its grace, and gone.
      row('lapsed', '2026-08-13T17:00:00.000Z'),
      // Booked to end at 17:00 and it is 17:30 — a host running late.
      row('overdue', '2026-08-14T16:00:00.000Z'),
      row('running', '2026-08-14T17:00:00.000Z'),
      row('future', '2026-08-14T18:00:00.000Z'),
    ]);

    const response = await GET(
      new Request('http://localhost/api/scheduled-sessions?filter=upcoming')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((session: ScheduledRow) => session.id)).toEqual([
      'overdue',
      'running',
      'future',
    ]);
    expect(body.data[0]).toMatchObject({
      invitee_count: 1,
      invitees: [{ email: 'guest@example.com', rsvp_status: 'accepted' }],
    });
    expect(body.data[0]).not.toHaveProperty('scheduled_session_invitees');
    // The longest allowed meeting plus its late grace, so the query cannot miss
    // a row the filter would have kept.
    expect(gte).toHaveBeenCalledWith('scheduled_at', '2026-08-13T21:30:00.000Z');
  });

  it('does not apply the running-meeting lookback to the all filter', async () => {
    const { gte, lt } = setupList([row('old', '2026-08-13T17:00:00.000Z')]);

    const response = await GET(new Request('http://localhost/api/scheduled-sessions?filter=all'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(gte).not.toHaveBeenCalled();
    expect(lt).not.toHaveBeenCalled();
  });

  it('advances the host recurring meetings before listing them', async () => {
    setupList([row('future', '2026-08-14T18:00:00.000Z')]);

    const response = await GET(
      new Request('http://localhost/api/scheduled-sessions?filter=upcoming')
    );

    expect(response.status).toBe(200);
    // A lapsed occurrence sits in the past — exactly what "upcoming" filters out —
    // so it has to be rolled forward before the query runs.
    expect(mockRollForwardHostSeries).toHaveBeenCalledWith(expect.anything(), mockUser.id);
  });

  it('keeps running and overrunning meetings out of the past filter', async () => {
    const { gte, lt } = setupList([
      row('lapsed', '2026-08-13T17:00:00.000Z'),
      row('overdue', '2026-08-14T16:00:00.000Z'),
      row('running', '2026-08-14T17:00:00.000Z'),
    ]);

    const response = await GET(new Request('http://localhost/api/scheduled-sessions?filter=past'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((session: ScheduledRow) => session.id)).toEqual(['lapsed']);
    expect(lt).toHaveBeenCalledWith('scheduled_at', '2026-08-14T17:30:00.000Z');
    expect(gte).not.toHaveBeenCalled();
  });
});
