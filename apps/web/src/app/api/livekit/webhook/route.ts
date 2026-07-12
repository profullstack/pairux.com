/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { WebhookReceiver, EgressStatus } from 'livekit-server-sdk';
import { serviceClient } from '@/lib/supabase/service';

/**
 * LiveKit webhook receiver — finalizes recordings.
 *
 * Configure on the SFU (livekit.yaml):
 *   webhook:
 *     api_key: <LIVEKIT_API_KEY>
 *     urls: [https://pairux.com/api/livekit/webhook]
 *
 * On egress_ended we flip the matching recordings row to 'ready' (or 'failed')
 * and stamp duration/size. Until this is wired on the droplet, recordings stay
 * in 'processing' — the file still uploads to storage, it just isn't surfaced.
 */
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
  } catch (err) {
    console.error('[livekit-webhook] handler error:', err);
    // Still 200 so LiveKit doesn't hammer retries on our bug.
  }

  return new Response('ok', { status: 200 });
}
