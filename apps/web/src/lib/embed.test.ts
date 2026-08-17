import { describe, it, expect } from 'vitest';
import {
  SITE_URL,
  clockDuration,
  embedUrl,
  escapeXml,
  iframeSnippet,
  isoDuration,
  joinCodeFromUrl,
  liveUrl,
  oembedUrl,
} from './embed';

describe('escapeXml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;'
    );
  });

  it('escapes ampersands before the entities it introduces', () => {
    expect(escapeXml('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });
});

describe('isoDuration', () => {
  it('formats hours, minutes and seconds', () => {
    expect(isoDuration(3723)).toBe('PT1H2M3S');
  });

  it('omits empty components', () => {
    expect(isoDuration(3600)).toBe('PT1H');
    expect(isoDuration(90)).toBe('PT1M30S');
  });

  it('keeps a seconds component for sub-minute durations', () => {
    expect(isoDuration(5)).toBe('PT5S');
  });

  it('returns null for absent or nonsense values', () => {
    expect(isoDuration(null)).toBeNull();
    expect(isoDuration(0)).toBeNull();
    expect(isoDuration(-10)).toBeNull();
    expect(isoDuration(Number.NaN)).toBeNull();
  });
});

describe('clockDuration', () => {
  it('pads minutes and seconds past an hour', () => {
    expect(clockDuration(3723)).toBe('1:02:03');
  });

  it('drops the hour component when under an hour', () => {
    expect(clockDuration(125)).toBe('2:05');
  });

  it('returns null for absent or nonsense values', () => {
    expect(clockDuration(null)).toBeNull();
    expect(clockDuration(0)).toBeNull();
  });
});

describe('url builders', () => {
  it('builds permalink and embed URLs from a join code', () => {
    expect(liveUrl('abc123')).toBe(`${SITE_URL}/l/abc123`);
    expect(embedUrl('abc123')).toBe(`${SITE_URL}/embed/abc123`);
  });

  it('points oEmbed discovery at the permalink', () => {
    expect(oembedUrl('abc123')).toBe(
      `${SITE_URL}/api/oembed?url=${encodeURIComponent(`${SITE_URL}/l/abc123`)}`
    );
  });
});

describe('iframeSnippet', () => {
  it('embeds the player URL at the default box', () => {
    const html = iframeSnippet('abc123');
    expect(html).toContain(`src="${SITE_URL}/embed/abc123"`);
    expect(html).toContain('width="640"');
    expect(html).toContain('height="400"');
    expect(html).toContain('allowfullscreen');
  });

  it('escapes the title so a crafted subject cannot break out of the attribute', () => {
    const html = iframeSnippet('abc123', { title: '"><script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('falls back to a default title when the subject is blank', () => {
    expect(iframeSnippet('abc123', { title: '   ' })).toContain('title="PairUX live"');
    expect(iframeSnippet('abc123', { title: null })).toContain('title="PairUX live"');
  });
});

describe('joinCodeFromUrl', () => {
  it('accepts permalink and embed paths on our hosts', () => {
    expect(joinCodeFromUrl('https://pairux.com/l/abc123')).toBe('abc123');
    expect(joinCodeFromUrl('https://www.pairux.com/l/abc123')).toBe('abc123');
    expect(joinCodeFromUrl('https://pairux.com/embed/abc123')).toBe('abc123');
  });

  it('tolerates a trailing slash and a query string', () => {
    expect(joinCodeFromUrl('https://pairux.com/l/abc123/')).toBe('abc123');
    expect(joinCodeFromUrl('https://pairux.com/l/abc123?utm_source=x')).toBe('abc123');
  });

  it('rejects other hosts, including lookalikes', () => {
    expect(joinCodeFromUrl('https://evil.com/l/abc123')).toBeNull();
    expect(joinCodeFromUrl('https://pairux.com.evil.com/l/abc123')).toBeNull();
    expect(joinCodeFromUrl('https://notpairux.com/l/abc123')).toBeNull();
  });

  it('rejects non-http schemes', () => {
    expect(joinCodeFromUrl('javascript:alert(1)')).toBeNull();
    expect(joinCodeFromUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects other paths on our host', () => {
    expect(joinCodeFromUrl('https://pairux.com/dashboard')).toBeNull();
    expect(joinCodeFromUrl('https://pairux.com/l/')).toBeNull();
    expect(joinCodeFromUrl('https://pairux.com/l/abc/extra')).toBeNull();
  });

  it('rejects join codes with characters the schema does not allow', () => {
    expect(joinCodeFromUrl('https://pairux.com/l/abc%2F..%2Fadmin')).toBeNull();
    expect(joinCodeFromUrl('https://pairux.com/l/abc.123')).toBeNull();
  });

  it('returns null for unparseable input', () => {
    expect(joinCodeFromUrl('not a url')).toBeNull();
    expect(joinCodeFromUrl('')).toBeNull();
  });
});
