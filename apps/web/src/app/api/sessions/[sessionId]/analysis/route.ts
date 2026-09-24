import { z } from 'zod';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import {
  CHUNK_INTERVAL_MS,
  FRAME_INTERVAL_MS,
  hostedAnalysisSession,
  type AnalysisRow,
} from '@/lib/call-analysis/store';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

const bodySchema = z.object({
  source: z.enum(['web', 'desktop', 'mobile']),
  mimeType: z
    .string()
    .max(100)
    .regex(/^(audio|video)\/[\w.+-]+(;\s*codecs=[\w.,"' -]+)?$/),
  chunkFormat: z.enum(['stream', 'segments']).default('stream'),
});

/**
 * POST /api/sessions/[sessionId]/analysis — the host's app starts capturing
 * the call for AI analysis. Only for sessions created with analysis on, and
 * only by the host. A host that reconnects mid-call gets the same capture back
 * (with how many chunks it already holds) instead of a second one.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const supabase = await createClient();
    const { user } = await getAuthenticatedUser(supabase);
    if (!user) return errorResponse('Authentication required', 401);

    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const db = serviceClient();
    const session = await hostedAnalysisSession(db, sessionId, user.id);
    if (!session) return errorResponse('This session was not started with AI analysis', 404);
    if (session.status === 'ended') return errorResponse('The session has ended', 410);

    const { data: existing } = (await db
      .from('call_analyses')
      .select('*')
      .eq('session_id', sessionId)
      .eq('status', 'recording')
      .maybeSingle()) as { data: AnalysisRow | null };

    let row = existing;
    // A reconnect can only resume the same recorder shape. A new format (for
    // example the host moved from the browser to the desktop app) starts a
    // separate capture; the old one is closed and analysed on its own.
    if (row && (row.mime_type !== body.mimeType || row.source !== body.source)) {
      await db
        .from('call_analyses')
        .update({ status: 'queued', queued_at: new Date().toISOString() } as never)
        .eq('id', row.id);
      row = null;
    }

    if (!row) {
      const { data: created, error } = (await db
        .from('call_analyses')
        .insert({
          session_id: sessionId,
          host_user_id: user.id,
          kind: session.analysis.kind,
          keep_recording: session.analysis.keepRecording,
          source: body.source,
          chunk_format: body.chunkFormat,
          mime_type: body.mimeType,
          title: session.subject,
          // Reports of an org or team call are readable by that org or team.
          org_id: session.org_id ?? null,
          team_id: session.team_id ?? null,
        } as never)
        .select('*')
        .single()) as { data: AnalysisRow | null; error: unknown };
      if (error || !created) return errorResponse('Could not start the analysis capture', 500);
      row = created;
    }

    return successResponse(
      {
        analysisId: row.id,
        /** Capture start (ms since epoch): frame times are measured from here. */
        startedAt: new Date(row.started_at).getTime(),
        chunkIntervalMs: CHUNK_INTERVAL_MS,
        frameIntervalMs: FRAME_INTERVAL_MS,
        kind: row.kind,
        keepRecording: row.keep_recording,
      },
      existing?.id === row.id ? 200 : 201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
