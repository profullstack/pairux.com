import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HostPresenceIndicator } from './HostPresenceIndicator';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  UserX: () => <span data-testid="user-x-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
}));

describe('HostPresenceIndicator', () => {
  it('returns null when host is present', () => {
    const { container } = render(
      <HostPresenceIndicator sessionStatus="active" currentHostId="host-123" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows "Host hasn\'t joined yet" for created sessions', () => {
    render(<HostPresenceIndicator sessionStatus="created" currentHostId={null} />);

    expect(screen.getByText("Host hasn't joined yet")).toBeInTheDocument();
    expect(screen.getByTestId('clock-icon')).toBeInTheDocument();
  });

  it('shows "Host has left" for paused sessions', () => {
    render(<HostPresenceIndicator sessionStatus="paused" currentHostId={null} />);

    expect(screen.getByText('Host has left')).toBeInTheDocument();
    expect(screen.getByTestId('user-x-icon')).toBeInTheDocument();
  });

  it('shows "Host has left" for active sessions with no host', () => {
    render(<HostPresenceIndicator sessionStatus="active" currentHostId={null} />);

    expect(screen.getByText('Host has left')).toBeInTheDocument();
  });

  it('shows chat availability message', () => {
    render(<HostPresenceIndicator sessionStatus="paused" currentHostId={null} />);

    expect(screen.getByText(/Chat is still available/)).toBeInTheDocument();
  });

  it('renders overlay with correct positioning classes', () => {
    const { container } = render(
      <HostPresenceIndicator sessionStatus="paused" currentHostId={null} />
    );

    const overlay = container.firstChild as HTMLElement;
    expect(overlay.className).toContain('absolute');
    expect(overlay.className).toContain('inset-0');
    expect(overlay.className).toContain('z-10');
  });
});
