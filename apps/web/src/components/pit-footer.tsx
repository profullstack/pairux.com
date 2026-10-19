// The pit.world network footer, fetched on the server from pit.world and
// cached for an hour. The root layout renders it as the last thing in <body>.
// Any failure (timeout, non-200, network) renders nothing, never a broken page.
// Its inline <style> is allowed by the CSP (style-src has 'unsafe-inline').
const PIT_FOOTER_URL = 'https://pit.world/snippets/footer.html?site=pairux.com';

async function fetchPitFooter(): Promise<string | null> {
  try {
    const res = await fetch(PIT_FOOTER_URL, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html.includes('data-pit-footer') ? html : null;
  } catch {
    return null;
  }
}

export async function PitFooter() {
  const html = await fetchPitFooter();
  if (!html) return null;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
