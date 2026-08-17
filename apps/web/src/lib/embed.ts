/**
 * Helpers shared by the embeddable player (/embed/<joinCode>), the oEmbed
 * endpoint (/api/oembed) and the per-channel RSS feed (/c/<handle>/rss.xml).
 *
 * These three surfaces are how a PairUX live leaves pairux.com: an iframe on
 * someone's blog, an unfurl in Slack/Notion, or an episode in a podcast app.
 */

/** Canonical public origin, no trailing slash. */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://pairux.com').replace(
  /\/+$/,
  ''
);

/** Default iframe box — 16:9 plus room for the title bar. */
export const EMBED_WIDTH = 640;
export const EMBED_HEIGHT = 400;

/** Public permalink for a live/recording. */
export function liveUrl(joinCode: string): string {
  return `${SITE_URL}/l/${encodeURIComponent(joinCode)}`;
}

/** Framable player URL for a live/recording. */
export function embedUrl(joinCode: string): string {
  return `${SITE_URL}/embed/${encodeURIComponent(joinCode)}`;
}

/** oEmbed discovery endpoint for a permalink. */
export function oembedUrl(joinCode: string): string {
  return `${SITE_URL}/api/oembed?url=${encodeURIComponent(liveUrl(joinCode))}`;
}

/** Escape a string for use in XML text or a double-quoted attribute. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The iframe snippet we hand out (copy button + oEmbed `html`). Escaped so it
 * is safe to drop straight into an HTML document.
 */
export function iframeSnippet(
  joinCode: string,
  options: { width?: number; height?: number; title?: string | null } = {}
): string {
  const width = options.width ?? EMBED_WIDTH;
  const height = options.height ?? EMBED_HEIGHT;
  const trimmed = options.title?.trim();
  const title = escapeXml(trimmed && trimmed.length > 0 ? trimmed : 'PairUX live');
  return (
    `<iframe src="${escapeXml(embedUrl(joinCode))}" width="${String(width)}" height="${String(height)}" ` +
    `frameborder="0" scrolling="no" allow="autoplay; fullscreen; picture-in-picture" ` +
    `allowfullscreen title="${title}"></iframe>`
  );
}

/** Seconds → ISO-8601 duration (`PT1H2M3S`), as schema.org and RSS expect. */
export function isoDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const hourPart = h > 0 ? `${String(h)}H` : '';
  const minutePart = m > 0 ? `${String(m)}M` : '';
  // Always emit a seconds component for sub-minute durations, so we never
  // produce a bare "PT".
  const secondPart = s > 0 || (h === 0 && m === 0) ? `${String(s)}S` : '';
  return `PT${hourPart}${minutePart}${secondPart}`;
}

/** Seconds → `H:MM:SS` / `M:SS`, the itunes:duration form podcast apps show. */
export function clockDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${String(h)}:${pad(m)}:${pad(s)}` : `${String(m)}:${pad(s)}`;
}

/**
 * Pull the join code out of a PairUX permalink or embed URL. Returns null for
 * anything that isn't ours — oEmbed consumers can and do send arbitrary URLs.
 */
export function joinCodeFromUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const allowedHosts = new Set<string>(['pairux.com', 'www.pairux.com']);
  try {
    allowedHosts.add(new URL(SITE_URL).host);
  } catch {
    /* SITE_URL is a constant we control; ignore a malformed override */
  }
  if (!allowedHosts.has(parsed.host)) return null;

  const match = /^\/(?:l|embed)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(parsed.pathname);
  return match?.[1] ?? null;
}
