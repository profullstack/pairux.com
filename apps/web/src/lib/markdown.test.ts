import { describe, it, expect } from 'vitest';
import { renderDescriptionHtml } from './markdown';

describe('renderDescriptionHtml', () => {
  it('escapes raw HTML so it cannot inject markup (XSS-safe)', () => {
    const html = renderDescriptionHtml('<img src=x onerror=alert(1)>');
    // The tag is neutralized to text (&lt;img …&gt;) — no live element in the DOM.
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script');
  });

  it('autolinks bare http(s) URLs with safe rel/target', () => {
    const html = renderDescriptionHtml('see https://moshcoding.com now');
    expect(html).toContain('<a href="https://moshcoding.com"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it('renders [text](url) links but only for http(s) — never javascript:', () => {
    expect(renderDescriptionHtml('[site](https://a.com)')).toContain('<a href="https://a.com"');
    const js = renderDescriptionHtml('[x](javascript:alert(1))');
    expect(js).not.toContain('href="javascript:');
    expect(js).not.toContain('<a ');
  });

  it('supports bold, italic, line breaks, and paragraphs', () => {
    const html = renderDescriptionHtml('**bold** *it*\nline2\n\npara2');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<br />');
    expect((html.match(/<p>/g) ?? []).length).toBe(2);
  });
});
