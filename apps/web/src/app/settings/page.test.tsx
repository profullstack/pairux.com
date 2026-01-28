import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsPage from './page';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock HeaderClient
vi.mock('@/components/header-client', () => ({
  HeaderClient: () => <header data-testid="header">Header</header>,
}));

// Mock Footer
vi.mock('@/components/footer', () => ({
  Footer: () => <footer data-testid="footer">Footer</footer>,
}));

// Mock NotificationPreferences (uses fetch and service worker APIs)
vi.mock('@/components/notifications/NotificationPreferences', () => ({
  NotificationPreferences: () => (
    <div data-testid="notification-preferences">Notification Preferences</div>
  ),
}));

const SETTINGS_KEY = 'pairux-web-settings';

describe('SettingsPage', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('should render settings page with all sections', () => {
      render(<SettingsPage />);

      expect(screen.getByText('Settings')).toBeInTheDocument();
      expect(screen.getByText('Account')).toBeInTheDocument();
      expect(screen.getByText('Recording')).toBeInTheDocument();
      expect(screen.getByText('Session Defaults')).toBeInTheDocument();
      expect(screen.getByText('Appearance')).toBeInTheDocument();
      expect(screen.getByText('About')).toBeInTheDocument();
    });

    it('should render header and footer', () => {
      render(<SettingsPage />);

      expect(screen.getByTestId('header')).toBeInTheDocument();
      expect(screen.getByTestId('footer')).toBeInTheDocument();
    });

    it('should render back link to dashboard', () => {
      render(<SettingsPage />);

      const backLink = screen.getByRole('link', { name: /back/i });
      expect(backLink).toHaveAttribute('href', '/dashboard');
    });
  });

  describe('loading settings', () => {
    it('should load settings from localStorage', () => {
      const savedSettings = {
        recording: { defaultQuality: '4k' },
        capture: { defaultQuality: '4k', includeAudio: false },
        session: { defaultMaxParticipants: 10 },
        appearance: { theme: 'dark' },
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(savedSettings));

      render(<SettingsPage />);

      // Check recording quality - find by text then get the select
      const recordingSelects = screen.getAllByRole('combobox');
      const recordingSelect = recordingSelects[0] as HTMLSelectElement;
      expect(recordingSelect.value).toBe('4k');

      // Check capture quality
      const captureSelect = recordingSelects[1] as HTMLSelectElement;
      expect(captureSelect.value).toBe('4k');

      // Check max participants
      const participantsSelect = recordingSelects[2] as HTMLSelectElement;
      expect(participantsSelect.value).toBe('10');
    });

    it('should use default settings when localStorage is empty', () => {
      render(<SettingsPage />);

      const selects = screen.getAllByRole('combobox');
      const recordingSelect = selects[0] as HTMLSelectElement;
      expect(recordingSelect.value).toBe('1080p');

      const captureSelect = selects[1] as HTMLSelectElement;
      expect(captureSelect.value).toBe('1080p');

      const participantsSelect = selects[2] as HTMLSelectElement;
      expect(participantsSelect.value).toBe('5');
    });

    it('should handle invalid JSON in localStorage', () => {
      localStorage.setItem(SETTINGS_KEY, 'invalid json');

      // Should not throw and should use defaults
      expect(() => render(<SettingsPage />)).not.toThrow();

      const selects = screen.getAllByRole('combobox');
      const recordingSelect = selects[0] as HTMLSelectElement;
      expect(recordingSelect.value).toBe('1080p');
    });
  });

  describe('saving settings', () => {
    it('should save recording quality to localStorage', async () => {
      render(<SettingsPage />);

      const selects = screen.getAllByRole('combobox');
      const recordingSelect = selects[0]!;
      fireEvent.change(recordingSelect, { target: { value: '720p' } });

      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
      expect(saved.recording.defaultQuality).toBe('720p');
    });

    it('should save capture quality to localStorage', async () => {
      render(<SettingsPage />);

      const selects = screen.getAllByRole('combobox');
      const captureSelect = selects[1]!;
      fireEvent.change(captureSelect, { target: { value: '720p' } });

      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
      expect(saved.capture.defaultQuality).toBe('720p');
    });

    it('should save max participants to localStorage', async () => {
      render(<SettingsPage />);

      const selects = screen.getAllByRole('combobox');
      const participantsSelect = selects[2]!;
      fireEvent.change(participantsSelect, { target: { value: '10' } });

      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
      expect(saved.session.defaultMaxParticipants).toBe(10);
    });

    it('should toggle include audio setting', async () => {
      render(<SettingsPage />);

      // Find the audio toggle button (the one near "Include System Audio" text)
      const audioSection = screen.getByText(/include system audio/i).closest('div');
      const audioToggle = audioSection?.parentElement?.querySelector('button');
      expect(audioToggle).toBeTruthy();

      fireEvent.click(audioToggle!);

      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
      expect(saved.capture.includeAudio).toBe(false);
    });

    it('should show saved indicator after saving', () => {
      render(<SettingsPage />);

      const selects = screen.getAllByRole('combobox');
      fireEvent.change(selects[0]!, { target: { value: '720p' } });

      expect(screen.getByText('Saved')).toBeInTheDocument();
    });
  });

  describe('theme selection', () => {
    it('should save theme to localStorage', async () => {
      render(<SettingsPage />);

      const darkButton = screen.getByRole('button', { name: /^dark$/i });
      fireEvent.click(darkButton);

      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
      expect(saved.appearance.theme).toBe('dark');
    });

    it('should highlight selected theme', async () => {
      render(<SettingsPage />);

      const darkButton = screen.getByRole('button', { name: /^dark$/i });
      fireEvent.click(darkButton);

      // Dark button should have the selected styling
      expect(darkButton.className).toContain('primary');
    });
  });

  describe('account section', () => {
    it('should show sign in and create account links', () => {
      render(<SettingsPage />);

      expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
      expect(screen.getByRole('link', { name: /create account/i })).toHaveAttribute(
        'href',
        '/signup'
      );
    });
  });

  describe('about section', () => {
    it('should display application info', () => {
      render(<SettingsPage />);

      expect(screen.getByText('PairUX Web')).toBeInTheDocument();
      expect(screen.getByText('Browser / PWA')).toBeInTheDocument();
      expect(screen.getByText(/screen share, recording, chat/i)).toBeInTheDocument();
    });

    it('should have link to download desktop app', () => {
      render(<SettingsPage />);

      const downloadLinks = screen.getAllByRole('link', { name: /desktop app/i });
      expect(downloadLinks.length).toBeGreaterThan(0);
      expect(downloadLinks[0]).toHaveAttribute('href', '/download');
    });
  });
});
