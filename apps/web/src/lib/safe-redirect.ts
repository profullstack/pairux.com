const BASE = 'https://same-origin.invalid';

/**
 * A redirect target that stays on this site, or null. Accepts only a path
 * ("/dashboard?x=1"). Rejects protocol-relative "//host", backslash forms
 * ("/\\host", which browsers and the URL parser read as "//host") and control
 * characters (tabs and newlines are stripped by the URL parser, so "/\t/host"
 * also becomes "//host").
 */
export function sameOriginPath(target: string | null | undefined): string | null {
  if (!target || !target.startsWith('/') || target.startsWith('//')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(target)) return null;
  try {
    if (new URL(target, BASE).origin !== BASE) return null;
  } catch {
    return null;
  }
  return target;
}
