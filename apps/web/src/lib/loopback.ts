/**
 * Only loopback redirects are accepted for CLI sign-in (RFC 8252 §7.3): the
 * code can land on the machine that asked for it and nowhere else. Any port,
 * fixed path. Pure, so both the server routes and the consent page use it.
 */
export function isLoopbackRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  return (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') &&
    url.port !== '' &&
    url.pathname === '/callback' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  );
}
