import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionSettingsPanel } from './SessionSettingsPanel';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Settings: () => <span data-testid="settings-icon" />,
  Info: () => <span data-testid="info-icon" />,
  Wifi: () => <span data-testid="wifi-icon" />,
  Palette: () => <span data-testid="palette-icon" />,
}));

const SETTINGS_KEY = 'pairux-web-settings';

describe('SessionSettingsPanel', () => {
  const defaultProps = {
    session: {
      id: 'session-123',
      join_code: 'ABC123',
      status: 'active',
      settings: { quality: 'medium', maxParticipants: 5 },
      created_at: '2024-01-01T00:00:00Z',
      session_participants: [],
    },
    connectionState: 'connected' as const,
    qualityMetrics: {
      bitrate: 1000000,
      frameRate: 30,
      packetLoss: 0.5,
      roundTripTime: 45,
    },
    networkQuality: 'good' as const,
    participantCount: 3,
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('renders session info', () => {
    render(<SessionSettingsPanel {...defaultProps} />);
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('3 / 5')).toBeInTheDocument();
  });

  it('renders session settings heading', () => {
    render(<SessionSettingsPanel {...defaultProps} />);
    expect(screen.getByText('Session Settings')).toBeInTheDocument();
  });

  it('displays connection quality metrics', () => {
    render(<SessionSettingsPanel {...defaultProps} />);
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByText('30 fps')).toBeInTheDocument();
    expect(screen.getByText('0.5%')).toBeInTheDocument();
    expect(screen.getByText('45 ms')).toBeInTheDocument();
  });

  it('renders without quality metrics', () => {
    render(<SessionSettingsPanel {...defaultProps} qualityMetrics={null} />);
    expect(screen.getByText('connected')).toBeInTheDocument();
    expect(screen.queryByText(/fps/)).not.toBeInTheDocument();
  });

  it('shows participant count without max when not set', () => {
    const propsNoMax = {
      ...defaultProps,
      session: { ...defaultProps.session, settings: { quality: 'medium' } },
    };
    render(<SessionSettingsPanel {...propsNoMax} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
  });

  it('toggles theme and saves to localStorage', () => {
    render(<SessionSettingsPanel {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /dark/i }));
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as {
      appearance?: { theme?: string };
    };
    expect(saved.appearance?.theme).toBe('dark');
  });

  it('loads saved theme from localStorage', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ appearance: { theme: 'dark' } }));
    render(<SessionSettingsPanel {...defaultProps} />);
    const darkButton = screen.getByRole('button', { name: /dark/i });
    expect(darkButton.className).toContain('bg-blue-600');
  });

  it('has data-testid for integration testing', () => {
    render(<SessionSettingsPanel {...defaultProps} />);
    expect(screen.getByTestId('session-settings-panel')).toBeInTheDocument();
  });
});
