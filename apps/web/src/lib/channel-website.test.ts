import { describe, it, expect } from 'vitest';
import { normalizeWebsiteUrl, websiteLabel, WEBSITE_URL_MAX_LENGTH } from './channel-website';

function ok(input: string | null | undefined): string | null {
  const r = normalizeWebsiteUrl(input);
  if (!r.ok) throw new Error(`expected ok for ${String(input)}: ${r.error}`);
  return r.url;
}

describe('normalizeWebsiteUrl', () => {
  it('treats empty, whitespace, null and undefined as "no website"', () => {
    expect(ok('')).toBeNull();
    expect(ok('   ')).toBeNull();
    expect(ok(null)).toBeNull();
    expect(ok(undefined)).toBeNull();
  });

  it('adds https:// when the scheme is missing', () => {
    expect(ok('cigarunderground.org')).toBe('https://cigarunderground.org');
    expect(ok('  www.example.com/about  ')).toBe('https://www.example.com/about');
    expect(ok('example.com:8080/x')).toBe('https://example.com:8080/x');
    expect(ok('//example.com')).toBe('https://example.com');
  });

  it('keeps http and https, lowercases the scheme and host', () => {
    expect(ok('http://example.com')).toBe('http://example.com');
    expect(ok('HTTPS://Example.COM/Path?q=1#h')).toBe('https://example.com/Path?q=1#h');
  });

  it('drops the bare trailing slash but keeps real paths', () => {
    expect(ok('https://cigarunderground.org/')).toBe('https://cigarunderground.org');
    expect(ok('https://example.com/blog/')).toBe('https://example.com/blog/');
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'ftp://example.com',
    'mailto:me@example.com',
    'file:///etc/passwd',
  ])('rejects the non-http scheme %s', (input) => {
    const r = normalizeWebsiteUrl(input);
    expect(r.ok).toBe(false);
  });

  it('rejects credentials, dotless hosts, spaces and garbage', () => {
    expect(normalizeWebsiteUrl('https://user:pw@example.com').ok).toBe(false);
    expect(normalizeWebsiteUrl('localhost').ok).toBe(false);
    expect(normalizeWebsiteUrl('localhost:3000').ok).toBe(false);
    expect(normalizeWebsiteUrl('javascript:1').ok).toBe(false);
    expect(normalizeWebsiteUrl('exa mple.com').ok).toBe(false);
    expect(normalizeWebsiteUrl('https://').ok).toBe(false);
  });

  it('gives a clear error message', () => {
    const r = normalizeWebsiteUrl('javascript:alert(1)');
    expect(r).toEqual({ ok: false, error: 'Website must be an http:// or https:// link.' });
  });

  it('enforces the maximum length', () => {
    const long = `https://example.com/${'a'.repeat(WEBSITE_URL_MAX_LENGTH)}`;
    const r = normalizeWebsiteUrl(long);
    expect(r.ok).toBe(false);
    const fits = `https://example.com/${'a'.repeat(WEBSITE_URL_MAX_LENGTH - 20)}`;
    expect(ok(fits)).toBe(fits);
  });

  it('produces values the database CHECK constraint accepts', () => {
    // Mirror of channels_website_url_format in 20260924180000_channel_website_url.sql.
    const dbCheck = /^https?:\/\/[^\s/?#@]+\.[^\s/?#@]+([/?#]\S*)?$/i;
    for (const input of [
      'cigarunderground.org',
      'http://example.com',
      'example.com:8080/x',
      'https://example.com/blog/?a=b#c',
      'bücher.example',
    ]) {
      expect(ok(input)).toMatch(dbCheck);
    }
  });
});

describe('websiteLabel', () => {
  it('shows the hostname without www', () => {
    expect(websiteLabel('https://cigarunderground.org')).toBe('cigarunderground.org');
    expect(websiteLabel('https://www.example.com/about?x=1')).toBe('example.com');
  });

  it('returns null for empty or non-http values', () => {
    expect(websiteLabel(null)).toBeNull();
    expect(websiteLabel('')).toBeNull();
    expect(websiteLabel('javascript:alert(1)')).toBeNull();
    expect(websiteLabel('not a url')).toBeNull();
  });
});
