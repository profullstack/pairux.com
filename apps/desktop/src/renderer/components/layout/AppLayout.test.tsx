import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AppLayout } from './AppLayout';
import { useUIStore } from '@/stores/ui';

vi.mock('./TitleBar', () => ({ TitleBar: () => null }));
vi.mock('@/routes/settings', () => ({
  SettingsPage: () => <div data-testid="settings-overlay" />,
}));

describe('AppLayout', () => {
  beforeEach(() => {
    useUIStore.setState({ settingsOpen: false });
  });

  it('keeps children mounted and only shows the settings overlay when open', () => {
    render(
      <AppLayout>
        <div data-testid="home">home</div>
      </AppLayout>
    );

    expect(screen.getByTestId('home')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-overlay')).toBeNull();

    act(() => {
      useUIStore.getState().openSettings();
    });

    // Home stays mounted underneath the overlay — the session is never torn down.
    expect(screen.getByTestId('home')).toBeInTheDocument();
    expect(screen.getByTestId('settings-overlay')).toBeInTheDocument();

    act(() => {
      useUIStore.getState().closeSettings();
    });
    expect(screen.queryByTestId('settings-overlay')).toBeNull();
    expect(screen.getByTestId('home')).toBeInTheDocument();
  });
});
