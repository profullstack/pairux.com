/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
import sharp from 'sharp';
import { createClient, getAuthenticatedUser } from '@/lib/supabase/server';
import { successResponse, errorResponse, handleApiError } from '@/lib/api';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/live/generate-banner
 *
 * Generates a 16:9-ish livestream cover banner with AI, using the live's
 * current banner as design inspiration. Primary: Anthropic Claude designs an
 * SVG which we rasterize with sharp. Fallback: OpenAI gpt-image-1 (image edit).
 * Returns a PNG data URL; the desktop cover-crops it to 1280x720.
 *
 * Body: { imageDataUrl?: string (current banner, data: or http URL),
 *         subject?: string, description?: string }
 */
interface Body {
  imageDataUrl?: string;
  subject?: string;
  description?: string;
  /** Optional free-text direction from the host for the banner. */
  prompt?: string;
}

function buildPrompt(subject?: string, description?: string, custom?: string): string {
  const title = (subject ?? '').trim() || 'a live coding / pair-programming session';
  const ctx = (description ?? '').trim();
  const wish = (custom ?? '').trim().slice(0, 500);
  return [
    `Design a bold, modern 16:9 cover thumbnail for a live developer stream on PairUX.`,
    `Stream title: "${title}".`,
    ctx ? `Context: ${ctx}.` : '',
    wish ? `The host's specific request (prioritize this): ${wish}.` : '',
    `Use the provided image as stylistic inspiration for palette and mood.`,
    `High-contrast, eye-catching, clean — suitable as a video thumbnail. Keep any`,
    `text minimal and clearly legible. No watermarks.`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Resolve a data: or http(s) image reference to raw bytes + mime. */
async function fetchImageBytes(ref: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(ref);
    if (m) {
      return {
        bytes: new Uint8Array(Buffer.from(m[2] ?? '', 'base64')),
        mime: m[1] ?? 'image/png',
      };
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
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1536x1024', n: 1 }),
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

async function generateWithAnthropic(
  apiKey: string,
  prompt: string,
  input: { bytes: Uint8Array; mime: string } | null
): Promise<string> {
  const content: any[] = [];
  if (input) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: input.mime.startsWith('image/') ? input.mime : 'image/jpeg',
        data: Buffer.from(input.bytes).toString('base64'),
      },
    });
  }
  content.push({
    type: 'text',
    text:
      `${prompt}\n\n` +
      `Output ONLY a single complete SVG document, exactly 1280x720 (viewBox="0 0 1280 720"), ` +
      `no markdown fences, no commentary. Use gradients, geometric shapes and at most a short ` +
      `title. Make it look like a polished stream cover.`,
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic ${String(res.status)}: ${t.slice(0, 300)}`);
  }
  const json: any = await res.json();
  const text: string = (json?.content ?? [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text as string)
    .join('\n');
  const svgMatch = /<svg[\s\S]*<\/svg>/i.exec(text);
  if (!svgMatch) throw new Error('Anthropic returned no SVG');
  const png = await sharp(Buffer.from(svgMatch[0]), { density: 144 })
    .resize(1280, 720, { fit: 'cover' })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { user, error: authError } = await getAuthenticatedUser(supabase);
    if (authError || !user) {
      return errorResponse('Authentication required', 401);
    }

    const body = (await request.json().catch(() => ({}))) as Body;
    const prompt = buildPrompt(body.subject, body.description, body.prompt);
    const input = body.imageDataUrl ? await fetchImageBytes(body.imageDataUrl) : null;

    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!openaiKey && !anthropicKey) {
      return errorResponse('Banner generation is not configured', 503);
    }

    // Primary: Anthropic (Claude designs an SVG we rasterize). Fallback: OpenAI
    // gpt-image-1. Collect errors for a useful message.
    const errors: string[] = [];
    if (anthropicKey) {
      try {
        const image = await generateWithAnthropic(anthropicKey, prompt, input);
        return successResponse({ image, source: 'anthropic' });
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        console.warn('[generate-banner] Anthropic failed, trying OpenAI:', e);
      }
    }
    if (openaiKey) {
      try {
        const image = await generateWithOpenAI(openaiKey, prompt, input);
        return successResponse({ image, source: 'openai' });
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        console.error('[generate-banner] OpenAI failed:', e);
      }
    }
    return errorResponse(`Could not generate a banner. ${errors.join(' | ')}`, 502);
  } catch (error) {
    return handleApiError(error);
  }
}
