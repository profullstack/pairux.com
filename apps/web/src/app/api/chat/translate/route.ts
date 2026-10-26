import { z } from 'zod';
import { SpeechError } from '@profullstack/live-translate';
import { authorizeMeetingCaller, MeetingAccessError } from '@/lib/translation/access';
import { isTranslationLanguage } from '@/lib/translation/languages';
import { translationRuntime } from '@/lib/translation/server';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const asksByCaller = new FixedWindowRateLimiter(60, 60_000);
const Body = z.object({
  sessionId: z.guid(),
  participantId: z.guid().optional(),
  to: z.string().refine(isTranslationLanguage, 'Unsupported language'),
  messages: z
    .array(z.object({ id: z.string().min(1).max(64), content: z.string().min(1).max(500) }))
    .min(1)
    .max(50),
});

// POST /api/chat/translate — meeting chat in the reader's language. Each reader
// asks for their own language; translations are cached per text and language,
// so a message read by ten people in Spanish is translated once.
export async function POST(request: Request) {
  try {
    const body = Body.parse(await request.json());
    const caller = await authorizeMeetingCaller(body.sessionId, body.participantId ?? '');
    if (!asksByCaller.check(`${body.sessionId}:${caller.userId ?? caller.participantId}`).success)
      return errorResponse('Too many translation requests. Try again shortly.', 429);
    const runtime = translationRuntime();
    if (!runtime) return errorResponse('Translation is not configured on this server.', 503);
    // Pro feature: chat translation rides on the host's plan (Pro or Team).
    if (!(await runtime.meter.isAdmin(caller.userId)))
      await runtime.meter.require(caller.hostUserId, body.sessionId);
    const { texts } = await runtime.translator.translate(
      body.messages.map((message) => message.content),
      'auto',
      body.to,
      { deadline: Date.now() + 20_000 }
    );
    return successResponse({
      to: body.to,
      translations: body.messages.map((message, index) => ({
        id: message.id,
        content: texts[index] ?? message.content,
      })),
    });
  } catch (error) {
    if (error instanceof MeetingAccessError || error instanceof SpeechError)
      return errorResponse(error.message, error.status);
    return handleApiError(error);
  }
}
