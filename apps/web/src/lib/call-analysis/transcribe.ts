/**
 * Speech to text for call analysis: OpenAI gpt-4o-transcribe-diarize, which
 * labels who is speaking. If a piece fails in diarized mode it is retried with
 * whisper-1 (no speaker labels) so one bad piece does not lose the report.
 *
 * Speaker labels come from the model per request. Each piece is transcribed
 * separately, so on calls longer than one piece (20 minutes) the same person
 * can carry different labels in different pieces; labels are prefixed with the
 * piece number in that case so they are never merged by mistake.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { TranscriptSegment } from './metrics';

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

interface DiarizedSegment {
  speaker?: string;
  text?: string;
  start?: number;
  end?: number;
}

async function post(form: FormData, apiKey: string, fetchImpl: typeof fetch): Promise<unknown> {
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (body as { error?: { message?: string } }).error?.message ?? `HTTP ${String(res.status)}`;
    throw new Error(`Transcription failed: ${message}`);
  }
  return body;
}

async function filePart(path: string): Promise<File> {
  return new File([await readFile(path)], basename(path), { type: 'audio/ogg' });
}

export async function transcribePiece(
  path: string,
  offsetMs: number,
  label: (speaker: string) => string,
  opts: { apiKey: string; fetchImpl?: typeof fetch }
): Promise<TranscriptSegment[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const form = new FormData();
    form.set('file', await filePart(path));
    form.set('model', 'gpt-4o-transcribe-diarize');
    form.set('response_format', 'diarized_json');
    form.set('chunking_strategy', 'auto');
    const body = (await post(form, opts.apiKey, fetchImpl)) as { segments?: DiarizedSegment[] };
    return (body.segments ?? [])
      .filter((s) => typeof s.text === 'string' && s.text.trim())
      .map((s) => ({
        startMs: offsetMs + Math.round((s.start ?? 0) * 1000),
        endMs: offsetMs + Math.round((s.end ?? s.start ?? 0) * 1000),
        speaker: s.speaker ? label(s.speaker) : null,
        text: (s.text ?? '').trim(),
      }));
  } catch (diarizeError) {
    console.error('[call-analysis] diarized transcription failed, using whisper-1:', diarizeError);
    const form = new FormData();
    form.set('file', await filePart(path));
    form.set('model', 'whisper-1');
    form.set('response_format', 'verbose_json');
    const body = (await post(form, opts.apiKey, fetchImpl)) as {
      segments?: { start?: number; end?: number; text?: string }[];
    };
    return (body.segments ?? [])
      .filter((s) => typeof s.text === 'string' && s.text.trim())
      .map((s) => ({
        startMs: offsetMs + Math.round((s.start ?? 0) * 1000),
        endMs: offsetMs + Math.round((s.end ?? s.start ?? 0) * 1000),
        speaker: null,
        text: (s.text ?? '').trim(),
      }));
  }
}

export async function transcribeAll(
  pieces: { path: string; offsetMs: number }[],
  opts: { apiKey: string; fetchImpl?: typeof fetch }
): Promise<TranscriptSegment[]> {
  const out: TranscriptSegment[] = [];
  for (const [i, piece] of pieces.entries()) {
    const label =
      pieces.length > 1
        ? (speaker: string) => `${speaker} (part ${String(i + 1)})`
        : (speaker: string) => speaker;
    out.push(...(await transcribePiece(piece.path, piece.offsetMs, label, opts)));
  }
  return out;
}
