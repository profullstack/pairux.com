/**
 * Safe markdown → HTML for short, user-provided room descriptions (shown on
 * /live and /u). XSS-safe by construction: the input is fully HTML-escaped
 * FIRST, then a small allowlist of inline markdown is applied, so no raw HTML
 * from the author can ever reach the DOM. Supports links + bare-URL autolink
 * (http/https only), **bold**, *italic*, `code`, paragraphs and line breaks.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function anchor(url: string, text: string): string {
  return `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow" class="underline hover:no-underline">${text}</a>`;
}

// Apply inline markdown to an already-HTML-escaped string.
function inline(escaped: string): string {
  let s = escaped;
  // [text](http-url) — links first so their URLs aren't re-autolinked.
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) =>
    anchor(url, text)
  );
  // Bare URL (only when at the start or preceded by whitespace, so we don't
  // match the href of a link we just built).
  s = s.replace(
    /(^|\s)(https?:\/\/[^\s<]+)/g,
    (_m, pre: string, url: string) => `${pre}${anchor(url, url)}`
  );
  // `code`
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // **bold**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // *italic* (single asterisk not adjacent to another)
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

export function renderDescriptionHtml(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((para) => `<p>${inline(escapeHtml(para)).replace(/\n/g, '<br />')}</p>`)
    .filter((p) => p !== '<p></p>')
    .join('');
}
