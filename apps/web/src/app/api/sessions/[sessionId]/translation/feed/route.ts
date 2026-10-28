import { NextResponse } from 'next/server';
import { SpeechError } from '@profullstack/live-translate';
import { authorizeMeetingCaller, MeetingAccessError } from '@/lib/translation/access';
import { translationRuntime } from '@/lib/translation/server';
import { copilotRuntime } from '@/lib/copilot/runtime';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A feeder sends one chunk per participant every 2 s; a prober one every 5 s.
const chunksByClient = new FixedWindowRateLimiter(1200, 60_000);
const MAX_BYTES = 128_000;
// A chunk every 2 s must not cost three database reads: a client id (random
// per page) stays authorized for its meeting for a minute.
const authorized = new Map<string, { self: string; until: number }>();
async function callerFor(sessionId: string, client: string, self: string): Promise<string> {
  const key = `${sessionId}:${client}`,
    found = authorized.get(key);
  if (found && found.until > Date.now() && found.self === self) return found.self;
  const caller = await authorizeMeetingCaller(sessionId, self);
  if (authorized.size > 5000) authorized.clear();
  authorized.set(key, { self: caller.participantId, until: Date.now() + 60_000 });
  return caller.participantId;
}

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// POST /api/sessions/:id/translation/feed?participant=&client=&self=
// Body: 2 s of 16 kHz mono s16le from `participant`'s track as this client
// receives it. Answers { feeder, wanted }: whether to keep sending.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const url = new URL(request.url);
    const participant = url.searchParams.get('participant') ?? '',
      client = url.searchParams.get('client') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(client))
      return NextResponse.json({ error: 'Invalid client.' }, { status: 400 });
    const self = await callerFor(sessionId, client, url.searchParams.get('self') ?? '');
    if (!chunksByClient.check(`${sessionId}:${client}`).success)
      return NextResponse.json({ error: 'Too many audio chunks.' }, { status: 429 });
    // The same uploads feed live translation and any AI copilot in the meeting.
    const room = translationRuntime()?.rooms.get(sessionId);
    const copilot = copilotRuntime();
    const copilotListening = (copilot?.listening(sessionId) ?? 0) > 0;
    if ((!room && !copilotListening) || participant === self)
      return NextResponse.json({ feeder: false, wanted: false });
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES)
      return NextResponse.json({ error: 'Audio chunk too large.' }, { status: 413 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_BYTES)
      return NextResponse.json({ error: 'Audio chunk too large.' }, { status: 413 });
    const answers = [
      room?.feed(participant, client, bytes),
      copilotListening ? copilot?.feed(sessionId, participant, client, bytes) : null,
    ].filter((answer): answer is { feeder: boolean; wanted: boolean } => Boolean(answer));
    return NextResponse.json({
      feeder: answers.some((answer) => answer.feeder),
      wanted: answers.some((answer) => answer.wanted),
    });
  } catch (error) {
    if (error instanceof MeetingAccessError || error instanceof SpeechError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[translation/feed]', error);
    return NextResponse.json({ error: 'Audio feed failed.' }, { status: 500 });
  }
}
