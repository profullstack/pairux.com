import { SpeechError, validChoices, type SharedEvent } from '@profullstack/live-translate';
import { authorizeMeetingCaller, MeetingAccessError } from '@/lib/translation/access';
import { translationRuntime } from '@/lib/translation/server';
import { FixedWindowRateLimiter, getClientIp } from '@/lib/rate-limit';
import { errorResponse, handleApiError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const joinsByIp = new FixedWindowRateLimiter(30, 60_000);

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// POST /api/sessions/:id/translation/listen — an event stream of this
// listener's translated lines and voices. Body: { participantId, choices }.
// Choosing again reconnects; closing the stream stops this listener's share.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    if (!joinsByIp.check(getClientIp(request)).success)
      return errorResponse('Too many translation connections. Try again shortly.', 429);
    const { sessionId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      participantId?: unknown;
      choices?: unknown;
    };
    const caller = await authorizeMeetingCaller(
      sessionId,
      typeof body.participantId === 'string' ? body.participantId : ''
    );
    const runtime = translationRuntime();
    if (!runtime) return errorResponse('Live translation is not configured on this server.', 503);
    const choices = validChoices(body.choices, caller.participantId);
    if (!choices.length) return errorResponse('Choose someone to translate.', 400);
    // The host pays. An admin may run translation in a meeting the host has not
    // paid for; it is then unpaid on the admin's account.
    const adminPayer =
      caller.userId &&
      !(await runtime.meter.funded(caller.hostUserId, sessionId)) &&
      (await runtime.meter.isAdmin(caller.userId))
        ? caller.userId
        : null;
    const payer = adminPayer ?? caller.hostUserId;
    const room = runtime.rooms.open(sessionId, payer);

    const encoder = new TextEncoder();
    let leave: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (heartbeat) clearInterval(heartbeat);
      leave?.();
      leave = null;
    };
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const send = (event: SharedEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        const close = () => {
          stop();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        try {
          leave = await room.listen({ id: crypto.randomUUID(), choices, send, close });
        } catch (error) {
          send({
            type: 'error',
            error:
              error instanceof SpeechError ? error.message : 'Live translation is unavailable.',
          });
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(': listening\n\n'));
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': listening\n\n'));
          } catch {
            stop();
          }
        }, 10_000);
        request.signal.addEventListener('abort', close, { once: true });
      },
      cancel: stop,
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    if (error instanceof MeetingAccessError || error instanceof SpeechError)
      return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
