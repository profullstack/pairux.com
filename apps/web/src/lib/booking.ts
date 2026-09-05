/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { randomBytes } from 'crypto';

import { createEmailer } from '@profullstack/emailer';

import { sendMeetingInvites } from '@/app/actions/meetings';
import type { serviceClient } from '@/lib/supabase/service';
import { getUniqueJoinCode } from '@/lib/join-code';
import {
  computeSlots,
  isSlotAvailable,
  type BusyInterval,
  type SlotOptions,
  type WeeklyAvailability,
} from '@/lib/booking-slots';

/**
 * The booking flow, from a public page to a meeting on the host's dashboard.
 *
 * A booking page is not a new kind of meeting. It is a way for someone with
 * no account to create an ordinary scheduled meeting on the host's calendar,
 * with themselves as the invitee — so the invite email, the reminders, the
 * Start button and the room are all the ones that already exist. This module
 * is the seam: it reads the page, works out what is free, and turns a chosen
 * slot into that row.
 */

type ServiceClient = ReturnType<typeof serviceClient>;

export interface BookingHost {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
}

export interface BookingPageRow {
  id: string;
  host_user_id: string;
  slug: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  timezone: string;
  availability: WeeklyAvailability;
  buffer_minutes: number;
  min_notice_minutes: number;
  max_days_ahead: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/** The page as the public API shows it: nothing a guest has no business seeing. */
export interface PublicBookingPage {
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  timezone: string;
  maxDaysAhead: number;
}

export interface PublicBookingHost {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
}

export function publicHost(host: BookingHost): PublicBookingHost {
  return {
    username: host.username,
    displayName: host.display_name ?? host.username,
    avatarUrl: host.avatar_url,
    bio: host.bio,
  };
}

export function publicPage(page: BookingPageRow): PublicBookingPage {
  return {
    slug: page.slug,
    title: page.title,
    description: page.description,
    durationMinutes: page.duration_minutes,
    timezone: page.timezone,
    maxDaysAhead: page.max_days_ahead,
  };
}

const USERNAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/;

/** The host a public URL names, or null. Case-insensitive like /u/<username>. */
export async function findHostByUsername(
  svc: ServiceClient,
  username: string
): Promise<BookingHost | null> {
  const wanted = username.trim();
  if (!USERNAME.test(wanted)) return null;
  const { data } = await (svc as any)
    .from('profiles')
    .select('id, username, display_name, avatar_url, bio')
    .ilike('username', wanted)
    .not('username', 'is', null)
    .limit(1)
    .maybeSingle();
  return (data as BookingHost | null) ?? null;
}

/** A host's active pages, for /book/<username>. */
export async function listActivePages(
  svc: ServiceClient,
  hostId: string
): Promise<BookingPageRow[]> {
  const { data } = await (svc as any)
    .from('booking_pages')
    .select('*')
    .eq('host_user_id', hostId)
    .eq('active', true)
    .order('created_at', { ascending: true });
  return (data as BookingPageRow[] | null) ?? [];
}

/** One active page by slug, or null. */
export async function findActivePage(
  svc: ServiceClient,
  hostId: string,
  slug: string
): Promise<BookingPageRow | null> {
  const { data } = await (svc as any)
    .from('booking_pages')
    .select('*')
    .eq('host_user_id', hostId)
    .eq('slug', slug.toLowerCase())
    .eq('active', true)
    .maybeSingle();
  return (data as BookingPageRow | null) ?? null;
}

/**
 * When the host is already spoken for between two instants.
 *
 * Every pending meeting counts, whether it came through a page or was
 * scheduled by hand, and a recurring series counts by its next occurrence —
 * which is the only one that exists as a row. Cancelled and completed ones do
 * not hold time.
 */
export async function hostBusy(
  svc: ServiceClient,
  hostId: string,
  fromMs: number,
  toMs: number
): Promise<BusyInterval[]> {
  // A meeting that started before the window can still overlap it; reach
  // back by the longest allowed duration.
  const reach = 8 * 60 * 60 * 1000;
  const { data } = await (svc as any)
    .from('scheduled_sessions')
    .select('scheduled_at, duration_minutes')
    .eq('host_user_id', hostId)
    .eq('status', 'pending')
    .gte('scheduled_at', new Date(fromMs - reach).toISOString())
    .lte('scheduled_at', new Date(toMs).toISOString());
  const rows = (data as { scheduled_at: string; duration_minutes: number }[] | null) ?? [];
  return rows.map((row) => {
    const start = Date.parse(row.scheduled_at);
    return {
      start: new Date(start).toISOString(),
      end: new Date(start + row.duration_minutes * 60_000).toISOString(),
    };
  });
}

/** The page's rules as the slot calculator takes them. */
export function slotOptionsFor(
  page: BookingPageRow,
  busy: BusyInterval[],
  extra: Pick<SlotOptions, 'fromDate' | 'days' | 'now'> = {}
): SlotOptions {
  return {
    availability: page.availability,
    timezone: page.timezone,
    durationMinutes: page.duration_minutes,
    bufferMinutes: page.buffer_minutes,
    minNoticeMinutes: page.min_notice_minutes,
    maxDaysAhead: page.max_days_ahead,
    busy,
    ...extra,
  };
}

const DAY = 24 * 60 * 60 * 1000;

/** The slots a page offers from a date, over a number of days. */
export async function availableSlots(
  svc: ServiceClient,
  page: BookingPageRow,
  fromDate: string | undefined,
  days: number,
  now = new Date()
) {
  const nowMs = now.getTime();
  // Busy time is read for the whole window the calculator can reach, plus a
  // day either side so zone offsets never cut a meeting off at the edge.
  const busy = await hostBusy(
    svc,
    page.host_user_id,
    nowMs - DAY,
    nowMs + (page.max_days_ahead + 2) * DAY
  );
  return computeSlots(slotOptionsFor(page, busy, { ...(fromDate ? { fromDate } : {}), days, now }));
}

export class BookingError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'BookingError';
  }
}

export interface BookingInput {
  start: string;
  name: string;
  email: string;
  notes?: string | undefined;
}

export interface BookingResult {
  meetingId: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  joinCode: string;
  joinUrl: string;
  hostName: string;
  /** The guest's RSVP page; "can't make it" there is how they cancel. */
  rsvpUrl: string;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://pairux.com';
}

/**
 * Take a slot.
 *
 * The slot is checked against the page's rules and the host's calendar as they
 * are *now*, not as the guest saw them a few minutes ago. Then the meeting is
 * written and the calendar is read once more: if another booking landed on the
 * same time in between, the later of the two is withdrawn and told to pick
 * again. That is a small window, and it closes without a lock.
 */
export async function createBooking(
  svc: ServiceClient,
  host: BookingHost,
  page: BookingPageRow,
  input: BookingInput,
  now = new Date()
): Promise<BookingResult> {
  const startMs = Date.parse(input.start);
  if (!Number.isFinite(startMs)) throw new BookingError('That time is not valid', 400);
  const startIso = new Date(startMs).toISOString();

  const busy = await hostBusy(svc, host.id, startMs - DAY, startMs + DAY);
  if (!isSlotAvailable(startIso, slotOptionsFor(page, busy, { now }))) {
    throw new BookingError('That time is no longer available. Please choose another.', 409);
  }

  const guestName = input.name.trim();
  const title = `${page.title} with ${guestName}`;
  const notes = input.notes?.trim();
  const description = [
    notes ? `Notes from ${guestName}: ${notes}` : '',
    `Booked via /book/${host.username}/${page.slug}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const joinCode = await getUniqueJoinCode(svc);
  const { data: meeting, error: insertError } = await (svc as any)
    .from('scheduled_sessions')
    .insert({
      host_user_id: host.id,
      title,
      description,
      scheduled_at: startIso,
      duration_minutes: page.duration_minutes,
      join_code: joinCode,
      recurrence_anchor_at: startIso,
      booking_page_id: page.id,
    })
    .select()
    .single();
  if (insertError || !meeting) {
    throw new BookingError('Could not save the booking. Please try again.', 500);
  }
  const meetingId = meeting.id as string;

  // The race check. Anything else pending that overlaps and was created before
  // us wins; we withdraw. Two bookings can never both survive this, because
  // whichever is created second sees the first.
  const endMs = startMs + page.duration_minutes * 60_000;
  const { data: rivals } = await (svc as any)
    .from('scheduled_sessions')
    .select('id, scheduled_at, duration_minutes, created_at')
    .eq('host_user_id', host.id)
    .eq('status', 'pending')
    .neq('id', meetingId)
    .gte('scheduled_at', new Date(startMs - 8 * 60 * 60 * 1000).toISOString())
    .lt('scheduled_at', new Date(endMs + page.buffer_minutes * 60_000).toISOString());
  const createdAt = Date.parse(meeting.created_at as string);
  const lost = ((rivals as any[] | null) ?? []).some((rival) => {
    const rivalStart = Date.parse(rival.scheduled_at as string);
    const rivalEnd = rivalStart + (rival.duration_minutes as number) * 60_000;
    const buffer = page.buffer_minutes * 60_000;
    const overlaps = rivalStart < endMs + buffer && rivalEnd > startMs - buffer;
    return overlaps && Date.parse(rival.created_at as string) <= createdAt;
  });
  if (lost) {
    await (svc as any).from('scheduled_sessions').delete().eq('id', meetingId);
    throw new BookingError('Someone just took that time. Please choose another.', 409);
  }

  const inviteToken = randomBytes(24).toString('hex');
  const { error: inviteeError } = await (svc as any).from('scheduled_session_invitees').insert({
    scheduled_session_id: meetingId,
    email: input.email,
    name: guestName,
    rsvp_status: 'accepted',
    invite_token: inviteToken,
  });
  if (inviteeError) {
    await (svc as any).from('scheduled_sessions').delete().eq('id', meetingId);
    throw new BookingError('Could not save the booking. Please try again.', 500);
  }

  const hostName = host.display_name ?? host.username;
  const base = appUrl();

  // The guest gets the standard invite: time, join code, calendar links, and
  // the RSVP buttons that double as their way to cancel.
  const invite = await sendMeetingInvites({
    scheduledSessionId: meetingId,
    title,
    description: notes,
    scheduledAt: startIso,
    durationMinutes: page.duration_minutes,
    joinCode,
    hostName,
    invitees: [{ email: input.email, name: guestName, token: inviteToken }],
  });
  if (!invite.ok) console.error('Booking invite email failed:', invite.error);

  await notifyHostOfBooking(svc, host, {
    title,
    guestName,
    guestEmail: input.email,
    notes,
    scheduledAt: startIso,
    durationMinutes: page.duration_minutes,
    joinCode,
  }).catch((error: unknown) => {
    console.error('Booking host notice failed:', error);
  });

  return {
    meetingId,
    title,
    scheduledAt: startIso,
    durationMinutes: page.duration_minutes,
    joinCode,
    joinUrl: `${base}/join/${joinCode}`,
    hostName,
    rsvpUrl: `${base}/invite/${inviteToken}`,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function hostBookingEmailHtml(opts: {
  hostName: string;
  title: string;
  guestName: string;
  guestEmail: string;
  notes: string | undefined;
  when: string;
  durationMinutes: number;
  joinCode: string;
  dashboardUrl: string;
}): string {
  const entries: [string, string][] = [
    ['Guest', `${escapeHtml(opts.guestName)} &lt;${escapeHtml(opts.guestEmail)}&gt;`],
    ['When', escapeHtml(opts.when)],
    ['Duration', `${String(opts.durationMinutes)} minutes`],
    [
      'Join code',
      `<span style="font-family:monospace;letter-spacing:3px;">${escapeHtml(opts.joinCode)}</span>`,
    ],
  ];
  if (opts.notes) entries.push(['Notes', escapeHtml(opts.notes)]);
  const rows = entries
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;width:110px;vertical-align:top;">${label}</td><td style="padding:6px 0;color:#111827;font-size:14px;">${value}</td></tr>`
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>New booking: ${escapeHtml(opts.title)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:32px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;letter-spacing:-.5px;">PairUX</h1>
      <p style="color:rgba(255,255,255,.75);margin:6px 0 0;font-size:13px;text-transform:uppercase;letter-spacing:1px;">New booking</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;margin:0 0 20px;">Hi ${escapeHtml(opts.hostName)}, someone booked time with you.</p>
      <h2 style="margin:0 0 20px;font-size:20px;color:#111827;font-weight:700;">${escapeHtml(opts.title)}</h2>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      </div>
      <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">It is on your dashboard with the rest of your meetings. Start it from there when the time comes and your guest will be emailed the link.</p>
      <div style="text-align:center;">
        <a href="${opts.dashboardUrl}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Open dashboard</a>
      </div>
    </div>
    <div style="background:#f9fafb;padding:18px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">Sent via <a href="https://pairux.com" style="color:#6366f1;text-decoration:none;">PairUX</a></p>
    </div>
  </div>
</body>
</html>`;
}

async function notifyHostOfBooking(
  svc: ServiceClient,
  host: BookingHost,
  booking: {
    title: string;
    guestName: string;
    guestEmail: string;
    notes: string | undefined;
    scheduledAt: string;
    durationMinutes: number;
    joinCode: string;
  }
): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return;

  // The host's login email lives in auth, not on the profile.
  const { data: userData } = await (svc as any).auth.admin.getUserById(host.id);
  const to = userData?.user?.email as string | undefined;
  if (!to) return;

  const defaultFrom = process.env.EMAIL_FROM ?? 'PairUX <hello@pairux.com>';
  const emailer = createEmailer({ resendApiKey, defaultFrom });
  const when = new Date(booking.scheduledAt).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  await (emailer as any).send({
    to,
    subject: `New booking: ${booking.title}`,
    html: hostBookingEmailHtml({
      hostName: host.display_name ?? host.username,
      title: booking.title,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      notes: booking.notes,
      when,
      durationMinutes: booking.durationMinutes,
      joinCode: booking.joinCode,
      dashboardUrl: `${appUrl()}/dashboard`,
    }),
  });
}
