import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  OverlayIndicators,
  RecordingIndicator,
  ControlActiveIndicator,
  SharingIndicator,
} from './OverlayIndicators';
import type { SessionParticipant } from '@pairux/shared-types';

const mockParticipant: SessionParticipant = {
  id: 'participant-1',
  session_id: 'session-1',
  user_id: 'user-1',
  display_name: 'Test User',
  role: 'viewer',
  control_state: 'granted',
  connection_status: 'connected',
  is_backup_host: false,
  last_seen_at: new Date().toISOString(),
  joined_at: new Date().toISOString(),
  left_at: null,
};

describe('OverlayIndicators', () => {
  describe('OverlayIndicators component', () => {
    it('renders sharing indicator when isSharing is true', () => {
      render(<OverlayIndicators isSharing={true} />);

      const indicator = screen.getByTestId('sharing-indicator');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveTextContent('LIVE');
    });

    it('does not render sharing indicator when isSharing is false', () => {
      render(<OverlayIndicators isSharing={false} />);

      expect(screen.queryByTestId('sharing-indicator')).not.toBeInTheDocument();
    });

    it('renders recording indicator when recording', () => {
      render(
        <OverlayIndicators
          recording={{
            isRecording: true,
            isPaused: false,
            duration: 65,
          }}
        />
      );

      const indicator = screen.getByTestId('recording-indicator');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveTextContent('REC');
      expect(indicator).toHaveTextContent('01:05');
    });

    it('does not render recording indicator when not recording', () => {
      render(
        <OverlayIndicators
          recording={{
            isRecording: false,
            isPaused: false,
            duration: 0,
          }}
        />
      );

      expect(screen.queryByTestId('recording-indicator')).not.toBeInTheDocument();
    });

    it('renders control active indicator when someone has control', () => {
      render(<OverlayIndicators controlledBy={mockParticipant} />);

      const indicator = screen.getByTestId('control-active-indicator');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveTextContent('Test User has control');
    });

    it('does not render control indicator when no one has control', () => {
      render(<OverlayIndicators controlledBy={null} />);

      expect(screen.queryByTestId('control-active-indicator')).not.toBeInTheDocument();
    });

    it('renders all indicators together', () => {
      render(
        <OverlayIndicators
          isSharing={true}
          recording={{
            isRecording: true,
            isPaused: false,
            duration: 30,
          }}
          controlledBy={mockParticipant}
        />
      );

      expect(screen.getByTestId('sharing-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('recording-indicator')).toBeInTheDocument();
      expect(screen.getByTestId('control-active-indicator')).toBeInTheDocument();
    });

    it('applies position classes correctly', () => {
      const { rerender } = render(<OverlayIndicators isSharing={true} position="top-left" />);

      let container = screen.getByTestId('overlay-indicators');
      expect(container).toHaveClass('left-4', 'top-4');

      rerender(<OverlayIndicators isSharing={true} position="top-right" />);
      container = screen.getByTestId('overlay-indicators');
      expect(container).toHaveClass('right-4', 'top-4');

      rerender(<OverlayIndicators isSharing={true} position="bottom-left" />);
      container = screen.getByTestId('overlay-indicators');
      expect(container).toHaveClass('left-4', 'bottom-4');

      rerender(<OverlayIndicators isSharing={true} position="bottom-right" />);
      container = screen.getByTestId('overlay-indicators');
      expect(container).toHaveClass('right-4', 'bottom-4');
    });
  });

  describe('RecordingIndicator component', () => {
    it('shows REC when not paused', () => {
      render(<RecordingIndicator isPaused={false} duration={0} />);

      expect(screen.getByText(/REC/)).toBeInTheDocument();
    });

    it('shows PAUSED when paused', () => {
      render(<RecordingIndicator isPaused={true} duration={0} />);

      expect(screen.getByText(/PAUSED/)).toBeInTheDocument();
    });

    it('formats duration correctly', () => {
      render(<RecordingIndicator isPaused={false} duration={125} />);

      expect(screen.getByText(/02:05/)).toBeInTheDocument();
    });

    it('formats hours correctly', () => {
      render(<RecordingIndicator isPaused={false} duration={3725} />);

      expect(screen.getByText(/01:02:05/)).toBeInTheDocument();
    });

    it('has animate-pulse when not paused', () => {
      render(<RecordingIndicator isPaused={false} duration={0} />);

      const circle = screen.getByTestId('recording-indicator').querySelector('svg');
      expect(circle).toHaveClass('animate-pulse');
    });

    it('does not have animate-pulse when paused', () => {
      render(<RecordingIndicator isPaused={true} duration={0} />);

      const circle = screen.getByTestId('recording-indicator').querySelector('svg');
      expect(circle).not.toHaveClass('animate-pulse');
    });
  });

  describe('ControlActiveIndicator component', () => {
    it('displays participant name', () => {
      render(<ControlActiveIndicator participant={mockParticipant} />);

      expect(screen.getByText('Test User has control')).toBeInTheDocument();
    });

    it('has monitor icon', () => {
      render(<ControlActiveIndicator participant={mockParticipant} />);

      const indicator = screen.getByTestId('control-active-indicator');
      const svg = indicator.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });

  describe('SharingIndicator component', () => {
    it('shows LIVE when isLive is true', () => {
      render(<SharingIndicator isLive={true} />);

      const indicator = screen.getByTestId('sharing-indicator');
      expect(indicator).toHaveTextContent('LIVE');
    });

    it('shows PREVIEW when isLive is false', () => {
      render(<SharingIndicator isLive={false} />);

      const indicator = screen.getByTestId('sharing-indicator');
      expect(indicator).toHaveTextContent('PREVIEW');
    });

    it('shows PREVIEW by default', () => {
      render(<SharingIndicator />);

      const indicator = screen.getByTestId('sharing-indicator');
      expect(indicator).toHaveTextContent('PREVIEW');
    });
  });
});
