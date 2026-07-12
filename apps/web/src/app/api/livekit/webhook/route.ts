/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { WebhookReceiver, EgressStatus } from 'livekit-server-sdk';
import { serviceClient } from '@/lib/supabase/service';
import { getEgressClient } from '@/lib/livekit-egress';

/**
 * LiveKit webhook receiver — finalizes recordings.
 *
 * Configure on the SFU (livekit.yaml):
 *   webhook:
 *     api_key: <LIVEKIT_API_KEY>
 *     urls: [https://pairux.com/api/livekit/webhook]
 *
 * - egress_ended → flip the matching recordings row to 'ready'/'failed'.
 * - participant_left → set the viewer's session_participants.left_at so the
 *   viewer count reflects real drops (LiveKit detects tab-close/disconnect;
 *   the client can't be trusted to fire a leave). participant.identity is the
 *   session_participants.id we mint the token with.
 * - room_finished → mark every remaining participant of that room as left.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return new Response('not configured', { status: 503 });
  }

  const body = await request.text();
  const authHeader = request.headers.get('Authorization') ?? '';

  let event: any;
  try {
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    event = await receiver.receive(body, authHeader);
  } catch (err) {
    console.warn('[livekit-webhook] signature validation failed:', err);
    return new Response('invalid signature', { status: 401 });
  }

  try {
    const info = event?.egressInfo;
    if (event?.event?.startsWith('egress_') && info?.egressId) {
      const status: EgressStatus = info.status;
      const done =
        status === EgressStatus.EGRESS_COMPLETE ||
        status === EgressStatus.EGRESS_FAILED ||
        status === EgressStatus.EGRESS_ABORTED;

      if (done) {
        const ok = status === EgressStatus.EGRESS_COMPLETE;
        const file = Array.isArray(info.fileResults) ? info.fileResults[0] : undefined;
        const durationNs: bigint | undefined = file?.duration;
        const sizeBytes: bigint | undefined = file?.size;

        const patch: Record<string, unknown> = {
          status: ok ? 'ready' : 'failed',
          ended_at: new Date().toISOString(),
        };
        if (ok && durationNs) patch.duration_seconds = Math.round(Number(durationNs) / 1e9);
        if (ok && sizeBytes) patch.size_bytes = Number(sizeBytes);

        const svc = serviceClient() as any;
        await svc.from('recordings').update(patch).eq('egress_id', info.egressId);
      }
    }

    // A participant dropped. Two cases:
    //  • the HOST (identity = their user id) → END the live. Even on a hard kill
    //    LiveKit fires this once its reconnect grace elapses, so clear the host,
    //    mark everyone left, and stop ALL egress for the room (recording +
    //    restream, incl. orphans) — otherwise egress keeps the room alive and
    //    nothing cleans up. This is the fix for killing the app without leaving.
    //  • a VIEWER (identity = session_participants.id) → just mark them left.
    if (event?.event === 'participant_left' && event?.participant?.identity) {
      const identity = String(event.participant.identity);
      const roomName = typeof event?.room?.name === 'string' ? event.room.name : '';
      const sm = /^session-(.+)$/.exec(roomName);
      const sessionId = sm?.[1] && UUID_RE.test(sm[1]) ? sm[1] : null;
      const svc = serviceClient() as any;

      let handledAsHost = false;
      if (sessionId) {
        const { data: sess } = await svc
          .from('sessions')
          .select('current_host_id')
          .eq('id', sessionId)
          .single();
        if (sess?.current_host_id && identity === sess.current_host_id) {
          handledAsHost = true;
          await svc
            .from('sessions')
            .update({ current_host_id: null, restream_egress_id: null })
            .eq('id', sessionId);
          await svc
            .from('session_participants')
            .update({ left_at: new Date().toISOString(), connection_status: 'disconnected' })
            .eq('session_id', sessionId)
            .is('left_at', null);
          const egress = getEgressClient();
          if (egress) {
            try {
              const active = await egress.listEgress({ roomName, active: true });
              await Promise.allSettled(active.map((e: any) => egress.stopEgress(e.egressId)));
            } catch {
              /* best-effort */
            }
          }
        }
      }

      if (!handledAsHost && UUID_RE.test(identity)) {
        await svc
          .from('session_participants')
          .update({ left_at: new Date().toISOString(), connection_status: 'disconnected' })
          .eq('id', identity)
          .is('left_at', null);
      }
    }

    // Room fully ended → mark every still-present participant left.
    if (event?.event === 'room_finished' && typeof event?.room?.name === 'string') {
      const m = /^session-(.+)$/.exec(event.room.name);
      if (m && UUID_RE.test(m[1] ?? '')) {
        const svc = serviceClient() as any;
        await svc
          .from('session_participants')
          .update({ left_at: new Date().toISOString(), connection_status: 'disconnected' })
          .eq('session_id', m[1])
          .is('left_at', null);
      }
    }
  } catch (err) {
    console.error('[livekit-webhook] handler error:', err);
    // Still 200 so LiveKit doesn't hammer retries on our bug.
  }

  return new Response('ok', { status: 200 });
}
