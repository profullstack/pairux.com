import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import { formatEventTime, LocalTime } from './LocalTime';

const ISO = '2026-11-25T17:00:00.000Z';

describe('LocalTime', () => {
  it('server-renders without throwing (Intl option combinations are valid)', () => {
    const html = renderToString(<LocalTime iso={ISO} locale="en" />);
    expect(html).toContain('dateTime="2026-11-25T17:00:00.000Z"');
    expect(html).toContain('UTC');
  });

  it('formats in every shipped locale, both zones, without throwing', () => {
    for (const locale of [
      'en',
      'ar',
      'de',
      'es',
      'fr',
      'hi',
      'id',
      'it',
      'ja',
      'ko',
      'nl',
      'pl',
      'pt',
      'ru',
      'sv',
      'tr',
      'uk',
      'vi',
      'zh',
    ]) {
      expect(formatEventTime(ISO, locale, 'utc')).not.toBe(ISO);
      expect(formatEventTime(ISO, locale, 'local')).not.toBe(ISO);
      expect(formatEventTime(ISO, locale, 'local', false)).not.toBe(ISO);
    }
  });

  it('falls back instead of throwing on a bad date or locale', () => {
    expect(formatEventTime('nope', 'en', 'utc')).toBe('nope');
    expect(() => formatEventTime(ISO, 'not a locale!!', 'local')).not.toThrow();
  });

  it('renders in the browser and swaps to local time', () => {
    render(<LocalTime iso={ISO} locale="en" />);
    expect(screen.getByText((_, el) => el?.tagName === 'TIME')).toBeTruthy();
  });
});
