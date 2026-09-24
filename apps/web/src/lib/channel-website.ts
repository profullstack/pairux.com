/**
 * A channel's optional website link (channels.website_url).
 *
 * Owners type whatever they type ("cigarunderground.org", "HTTPS://Example.com/",
 * "javascript:alert(1)"). normalizeWebsiteUrl turns that into a canonical
 * http(s) URL or a user-facing error; the database CHECK constraint
 * (channels_website_url_format) is the backstop for anything that skips this.
 */

export const WEBSITE_URL_MAX_LENGTH = 500;

export type WebsiteUrlResult = { ok: true; url: string | null } | { ok: false; error: string };

// "scheme:" at the start. A bare "host:port" (example.com:8080) also matches the
// shape, so a scheme is only treated as one when what follows the colon is not
// a port number.
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):(?!\d)/i;

/**
 * Normalize an owner-entered website. An empty string means "no website"
 * (returns url: null). Adds https:// when no scheme is given, rejects any
 * scheme other than http/https, embedded credentials, hosts without a dot,
 * and anything longer than WEBSITE_URL_MAX_LENGTH.
 */
export function normalizeWebsiteUrl(input: string | null | undefined): WebsiteUrlResult {
  const raw = (input ?? '').trim();
  if (raw === '') return { ok: true, url: null };
  if (/\s/.test(raw)) return { ok: false, error: 'Website URL cannot contain spaces.' };

  let candidate = raw;
  if (raw.startsWith('//')) {
    candidate = `https:${raw}`;
  } else {
    const scheme = SCHEME_RE.exec(raw)?.[1]?.toLowerCase();
    if (scheme === undefined) candidate = `https://${raw}`;
    else if (scheme !== 'http' && scheme !== 'https') {
      return { ok: false, error: 'Website must be an http:// or https:// link.' };
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'That does not look like a valid website URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Website must be an http:// or https:// link.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Website URL cannot include a username or password.' };
  }
  const host = parsed.hostname;
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) {
    return { ok: false, error: 'Website needs a full domain, like example.com.' };
  }

  // A bare origin reads better without the trailing slash URL() adds.
  let url = parsed.href;
  if (parsed.pathname === '/' && !parsed.search && !parsed.hash) url = url.slice(0, -1);

  if (url.length > WEBSITE_URL_MAX_LENGTH) {
    return {
      ok: false,
      error: `Website URL must be ${String(WEBSITE_URL_MAX_LENGTH)} characters or fewer.`,
    };
  }
  return { ok: true, url };
}

/**
 * The label shown for a stored website: its hostname without a leading
 * "www.", e.g. "https://www.cigarunderground.org/about" -> "cigarunderground.org".
 * Returns null for anything that is not a parseable http(s) URL, so a bad row
 * never renders as a link.
 */
export function websiteLabel(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}
