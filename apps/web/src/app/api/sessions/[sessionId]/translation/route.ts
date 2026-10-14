import { authorizeMeetingCaller, MeetingAccessError } from '@/lib/translation/access';
import { TRANSLATION_LANGUAGES } from '@/lib/translation/languages';
import { TRANSLATION_PASSES } from '@/lib/translation/meter';
import { translationRuntime } from '@/lib/translation/server';
import { errorResponse, handleApiError, successResponse } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

// GET /api/sessions/:id/translation?participantId= — whether live translation
// is available in this meeting, the languages, and (for the host) their credit.
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { sessionId } = await params;
    const participantId = new URL(request.url).searchParams.get('participantId') ?? '';
    const caller = await authorizeMeetingCaller(sessionId, participantId);
    const runtime = translationRuntime();
    const access = runtime && caller.isHost ? await runtime.meter.access(caller.hostUserId) : null;
    return successResponse({
      available: Boolean(runtime),
      languages: TRANSLATION_LANGUAGES.map(([code, name]) => ({ code, name })),
      isHost: caller.isHost,
      // Clients tap and upload remote tracks only while someone is listening.
      listening: runtime?.rooms.get(sessionId)?.size ?? 0,
      // Paid feature: everyone in the meeting can see whether the host's pass covers it.
      funded: runtime
        ? (await runtime.meter.funded(caller.hostUserId, sessionId)) ||
          (await runtime.meter.isAdmin(caller.userId))
        : false,
      access,
      passes: caller.isHost ? TRANSLATION_PASSES : [],
    });
  } catch (error) {
    if (error instanceof MeetingAccessError) return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
