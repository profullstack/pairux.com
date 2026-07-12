/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import { EncodedFileOutput, EncodedFileType, EncodingOptions, S3Upload } from 'livekit-server-sdk';
import { serviceClient } from '@/lib/supabase/service';
import { getEgressClient } from '@/lib/livekit-egress';

/**
 * Server-side session recording via LiveKit Egress.
 *
 * When an SFU session goes live the egress service (already running on the SFU
 * droplet) composites the room and uploads a single MP4 straight to Supabase
 * Storage's S3 endpoint — nothing touches the host's machine. The finished file
 * is finalized by the LiveKit webhook (see api/livekit/webhook) and watched
 * later on /l/<join_code> and channel pages.
 *
 * Recording is a no-op until the SUPABASE_S3_* env vars are set, so it can be
 * shipped dark and enabled by adding the storage credentials.
 */

const BUCKET = 'recordings';

interface S3Config {
  accessKey: string;
  secret: string;
  region: string;
  endpoint: string;
}

function s3Config(): S3Config | null {
  const accessKey = process.env.SUPABASE_S3_ACCESS_KEY;
  const secret = process.env.SUPABASE_S3_SECRET_KEY;
  const endpoint = process.env.SUPABASE_S3_ENDPOINT; // https://<ref>.storage.supabase.co/storage/v1/s3
  const region = process.env.SUPABASE_S3_REGION ?? 'us-east-1';
  if (!accessKey || !secret || !endpoint) return null;
  return { accessKey, secret, region, endpoint };
}

function publicUrl(storagePath: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

interface StartInput {
  sessionId: string;
  channelId: string | null;
  creatorId: string | null;
  subject: string | null;
}

/**
 * Start recording a session to storage. Safe to call fire-and-forget; guarded
 * to run at most once per session by the mark_recording_started flip upstream.
 */
export async function startSessionRecording(input: StartInput): Promise<void> {
  try {
    const egress = getEgressClient();
    const s3 = s3Config();
    if (!egress || !s3) {
      if (!s3) console.warn('[recording] SUPABASE_S3_* not configured — recording disabled');
      return;
    }

    const roomName = `session-${input.sessionId}`;
    const storagePath = `sessions/${input.sessionId}/${String(Date.now())}.mp4`;
    const url = publicUrl(storagePath);

    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: storagePath,
      disableManifest: true,
      output: {
        case: 's3',
        value: new S3Upload({
          accessKey: s3.accessKey,
          secret: s3.secret,
          region: s3.region,
          endpoint: s3.endpoint,
          bucket: BUCKET,
          forcePathStyle: true,
        }),
      },
    });

    // 720p30 keeps a recording of *every* session affordable on the 4-vCPU SFU
    // droplet (each RoomComposite ~= 1 headless Chrome + 1 H264 encode).
    const encodingOptions = new EncodingOptions({
      width: 1280,
      height: 720,
      framerate: 30,
      videoBitrate: 2500,
      audioBitrate: 128,
      keyFrameInterval: 2,
    });

    const info = await egress.startRoomCompositeEgress(
      roomName,
      { file: output },
      { layout: 'grid', encodingOptions }
    );

    const svc = serviceClient() as any;
    await svc.from('recordings').insert({
      session_id: input.sessionId,
      channel_id: input.channelId,
      creator_id: input.creatorId,
      subject: input.subject,
      egress_id: info.egressId,
      storage_path: storagePath,
      playback_url: url,
      status: 'recording',
    });
  } catch (err) {
    console.error('[recording] start failed:', err);
  }
}

/**
 * Stop recording a session (host left). The egress finalizes + uploads
 * asynchronously; the LiveKit webhook flips the row to 'ready'. Also fires
 * automatically when the room empties (empty_timeout), so this is best-effort.
 */
export async function stopSessionRecording(sessionId: string): Promise<void> {
  try {
    const svc = serviceClient() as any;
    const { data } = await svc
      .from('recordings')
      .select('id, egress_id')
      .eq('session_id', sessionId)
      .in('status', ['recording', 'processing']);

    const rows: { id: string; egress_id: string | null }[] = data ?? [];
    if (rows.length === 0) return;

    const egress = getEgressClient();
    await Promise.allSettled(
      rows.map(async (r) => {
        if (egress && r.egress_id) {
          try {
            await egress.stopEgress(r.egress_id);
          } catch (e) {
            console.warn('[recording] stopEgress failed (may already be stopping):', e);
          }
        }
        await svc
          .from('recordings')
          .update({ status: 'processing', ended_at: new Date().toISOString() })
          .eq('id', r.id)
          .eq('status', 'recording');
      })
    );
  } catch (err) {
    console.error('[recording] stop failed:', err);
  }
}
