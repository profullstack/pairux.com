/**
 * CORS headers for cross-origin API requests.
 *
 * The desktop Electron app loads from file:// origin with webSecurity enabled,
 * requiring Access-Control-Allow-Origin: * on API responses.
 * Token-based auth (not cookies) is used, so wildcard origin is safe.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};
