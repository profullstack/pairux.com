/**
 * Personal room slugs: pairux.com/m/<slug>. Kept in step with the SQL in
 * supabase/migrations/20261122180000_personal_rooms.sql (the CHECK constraint,
 * personal_room_slug_base and personal_room_slug_reserved).
 */

export const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'billing',
  'blog',
  'book',
  'c',
  'dashboard',
  'docs',
  'download',
  'help',
  'host',
  'join',
  'live',
  'login',
  'logout',
  'm',
  'me',
  'new',
  'pairux',
  'pricing',
  'r',
  'recordings',
  'room',
  'rooms',
  'root',
  'settings',
  'signup',
  'start',
  'support',
  'system',
  'token',
  'u',
  'upgrade',
  'www',
]);

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const MAX_ROOMS_PER_USER = 10;

/** Lowercase ASCII letters/digits with single dashes, at most 32 characters. */
export function slugBase(text: string | null | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}

/** Why a slug can't be used, or null when it can. */
export function slugProblem(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug))
    return 'Use 3-40 lowercase letters, digits and dashes (no dash at the ends).';
  if (slug.includes('--')) return 'Use single dashes.';
  if (RESERVED_SLUGS.has(slug)) return 'That link is reserved.';
  return null;
}

/** First free slug for a base: base, base-2, base-3, ... */
export function uniqueSlug(base: string, taken: (slug: string) => boolean): string {
  let root = base;
  if (root.length < 3 || RESERVED_SLUGS.has(root)) root = slugBase(`${root || 'room'}-room`);
  let slug = root;
  for (let n = 2; taken(slug); n++) slug = `${root}-${String(n)}`;
  return slug;
}

/** The default room's slug source: username, else display name (no email), else email local part. */
export function defaultSlugSource(p: {
  username?: string | null;
  display_name?: string | null;
  email?: string | null;
}): string {
  const display = (p.display_name ?? '').split('@')[0]?.trim() ?? '';
  const local = (p.email ?? '').split('@')[0] ?? '';
  const source = [p.username ?? '', display, local].find((x) => x.trim() !== '') ?? '';
  return slugBase(source);
}

export function roomUrl(slug: string, origin = 'https://pairux.com'): string {
  return `${origin.replace(/\/+$/, '')}/m/${slug}`;
}
