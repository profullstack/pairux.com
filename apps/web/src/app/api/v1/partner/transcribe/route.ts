import { successResponse, errorResponse, handleApiError } from '@/lib/api';
import { FixedWindowRateLimiter } from '@/lib/rate-limit';
import { authenticatePartner } from '@/lib/partners';
import { whisperTranscribe } from '@/lib/copilot/voice';

/**
 * POST /api/v1/partner/transcribe: speech to text on PairUX's self-hosted
 * Whisper (the free copilot path, COPILOT_STT_URL), for a partner's agents
 * hearing a person in a partner session.
 *
 *   Authorization: Bearer pux_pk_…
 *   Content-Type: audio/wav   (one utterance, 16-bit PCM, up to 60 s)
 *   -> { text, language, duration }
 */
const byPartner = new FixedWindowRateLimiter(240, 60_000);
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const partner = authenticatePartner(request);
    if (!partner) return errorResponse('Unknown or missing partner key', 401);
    if (!byPartner.check(partner.id).success) return errorResponse('Too many requests', 429);

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length < 44 || bytes.length > MAX_BYTES) {
      return errorResponse('Send one WAV utterance (44 bytes to 4 MB)', 400);
    }
    const url = (process.env.COPILOT_STT_URL ?? 'http://127.0.0.1:8178/v1').replace(/\/+$/, '');
    const model = process.env.COPILOT_STT_MODEL ?? 'Systran/faster-whisper-small';
    const out = (await whisperTranscribe(bytes, {
      url,
      model,
      language: new URL(request.url).searchParams.get('language') ?? undefined,
      timeoutMs: 30_000,
    })) as { text?: string; language?: string; duration?: number };
    return successResponse({
      text: (out.text ?? '').trim(),
      language: out.language ?? null,
      duration: out.duration ?? null,
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 503) return errorResponse('Speech to text is unavailable right now', 503);
    return handleApiError(error);
  }
}
