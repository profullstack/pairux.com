import { describe, expect, it } from 'vitest';
import { render as plainRender } from '@testing-library/react';
import { fireEvent, render, screen } from '@/test/intl';
import { HeaderClient } from './header-client';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LOCALES, LOCALE_COOKIE, LOCALE_STORAGE_KEY, localeName } from '@/i18n/locales';

describe('LanguageSwitcher', () => {
  it('lists every locale by its native name, with the active one selected', () => {
    render(<LanguageSwitcher />, { locale: 'de' });
    const select = screen.getByRole<HTMLSelectElement>('combobox');
    expect(select.value).toBe('de');
    expect(screen.getAllByRole('option')).toHaveLength(LOCALES.length);
    expect(screen.getByRole('option', { name: '日本語' })).toBeInTheDocument();
    expect(localeName('ar')).toBe('العربية');
  });

  it('persists the choice to the NEXT_LOCALE cookie and localStorage and sets dir', () => {
    render(<LanguageSwitcher />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ar' } });
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=ar`);
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('HeaderClient translations', () => {
  it('renders English without an explicit provider (test-setup fallback)', () => {
    plainRender(<HeaderClient user={null} />);
    expect(screen.getAllByText('Pricing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sign in').length).toBeGreaterThan(0);
  });
});
