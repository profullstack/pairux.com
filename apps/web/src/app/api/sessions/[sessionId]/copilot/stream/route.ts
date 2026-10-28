import type { CopilotEvent } from '@pairux/meeting-copilot/types';
import { CORS_HEADERS } from '@/lib/cors';
import { body, callerAgent, copilotError } from '@/lib/copilot/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// POST /api/sessions/:id/copilot/stream — the owner's live copilot events
// (state first, then lines, notes, suggestions, notices, ended). Body: { participantId }.
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const input = await body(request);
    const { agent } = await callerAgent(
      request,
      sessionId,
      typeof input.participantId === 'string' ? input.participantId : ''
    );
    const encoder = new TextEncoder();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let send: ((event: CopilotEvent) => void) | null = null;
    const stop = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (send) agent.subscribers.delete(send);
      send = null;
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          stop();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        send = (event) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event.type === 'ended') queueMicrotask(close);
        };
        agent.subscribers.add(send);
        send({ type: 'state', state: agent.state });
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': copilot\n\n'));
            agent.lastSeen = Date.now();
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
        // The desktop app streams this from a file:// page.
        ...CORS_HEADERS,
      },
    });
  } catch (error) {
    return copilotError(error);
  }
}
