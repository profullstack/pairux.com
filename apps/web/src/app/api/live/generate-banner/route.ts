/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/live/generate-banner
 *
 * Generates a banner with OpenAI gpt-image-1 (a real image model, quality=high),
 * using the current banner as design input. Returns a PNG data URL; the client
 * cover-crops it to the target size (16:9 live thumbnail / 6:1 channel header).
 *
 * Body: { imageDataUrl?: string (current banner, data: or http URL),
 *         subject?: string, description?: string, prompt?: string,
 *         format?: 'live' | 'channel' }
 */
type Format = 'live' | 'channel';
interface FormatSpec {
  w: number;
  h: number;
  label: string;
}
const FORMATS: Record<Format, FormatSpec> = {
  live: { w: 1280, h: 720, label: 'a 16:9 (widescreen) cover thumbnail for a live developer stream' },
  channel: {
    w: 1500,
    h: 250,
    label: 'a 6:1 ultra-wide channel header banner (like a YouTube channel art strip)',
  },
};

interface Body {
  imageDataUrl?: string;
  subject?: string;
  description?: string;
  prompt?: string;
  format?: Format;
}

function buildPrompt(fmt: FormatSpec, subject?: string, description?: string, custom?: string): string {
  const title = (subject ?? '').trim() || 'a live coding / pair-programming session';
  const ctx = (description ?? '').trim();
  const wish = (custom ?? '').trim().slice(0, 500);
  return [
    `Design ${fmt.label} on PairUX, composed for a ${String(fmt.w)}x${String(fmt.h)} frame.`,
    `Compose the key subject in the horizontal center band so it survives a wide crop.`,
    `Name/title: "${title}".`,
    ctx ? `Context: ${ctx}.` : '',
    wish ? `The user's specific request (prioritize this): ${wish}.` : '',
    `Use the provided image as design inspiration for palette and mood.`,
    `Bold, modern, high-contrast, professional. Keep any text minimal and clearly legible. No watermarks.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Resolve a data: or http(s) image reference to raw bytes + mime. */
async function fetchImageBytes(ref: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(ref);
    if (m) {
      return { bytes: new Uint8Array(Buffer.from(m[2] ?? '', 'base64')), mime: m[1] ?? 'image/png' };
    }
    if (/^https?:\/\//.test(ref)) {
      const res = await fetch(ref);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return { bytes: new Uint8Array(buf), mime: res.headers.get('content-type') ?? 'image/jpeg' };
    }
  } catch {
    /* fall through */
  }
  return null;
}

async function generateWithOpenAI(
  apiKey: string,
  prompt: string,
  input: { bytes: Uint8Array; mime: string } | null
): Promise<string> {
  let res: Response;
  if (input) {
    // Image edit — uses the current banner as the basis.
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', prompt);
    form.append('size', '1536x1024');
    form.append('quality', 'high');
    form.append('n', '1');
    const ext = input.mime.includes('png') ? 'png' : input.mime.includes('webp') ? 'webp' : 'jpg';
    const ab = input.bytes.buffer.slice(
      input.bytes.byteOffset,
      input.bytes.byteOffset + input.bytes.byteLength
    ) as ArrayBuffer;
    form.append('image', new Blob([ab], { type: input.mime }), `banner.${ext}`);
    res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        size: '1536x1024',
        quality: 'high',
        n: 1,
      }),
    });
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${String(res.status)}: ${t.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const b64: string | undefined = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image');
  return `data:image/png;base64,${b64}`;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    const body = (await request.json().catch(() => ({}))) as Body;
    const fmt = FORMATS[body.format === 'channel' ? 'channel' : 'live'];
    const prompt = buildPrompt(fmt, body.subject, body.description, body.prompt);
    const input = body.imageDataUrl ? await fetchImageBytes(body.imageDataUrl) : null;

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return errorResponse('Banner generation is not configured', 503);
    }

    try {
      const image = await generateWithOpenAI(openaiKey, prompt, input);
      return successResponse({ image, source: 'openai' });
    } catch (e) {
      console.error('[generate-banner] OpenAI failed:', e);
      return errorResponse(
        `Could not generate a banner. ${e instanceof Error ? e.message : String(e)}`,
        502
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
