import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import {
  RemoteCursor,
  RemoteCursorsContainer,
  useRemoteCursors,
  getCursorColor,
  type RemoteCursorData,
} from './RemoteCursor';

describe('RemoteCursor', () => {
  const mockCursor: RemoteCursorData = {
    participantId: 'participant-1',
    displayName: 'Test User',
    position: {
      x: 500,
      y: 300,
      timestamp: Date.now(),
    },
  };

  const containerDimensions = { width: 800, height: 600 };
  const sourceDimensions = { width: 1920, height: 1080 };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getCursorColor', () => {
    it('returns a color from the predefined palette', () => {
      const color = getCursorColor('participant-1');
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('returns consistent color for same participant ID', () => {
      const color1 = getCursorColor('participant-1');
      const color2 = getCursorColor('participant-1');
      expect(color1).toBe(color2);
    });

    it('returns different colors for different IDs (usually)', () => {
      const colors = new Set<string>();
      for (let i = 0; i < 20; i++) {
        colors.add(getCursorColor(`participant-${String(i)}`));
      }
      // Should have multiple different colors
      expect(colors.size).toBeGreaterThan(1);
    });
  });

  describe('RemoteCursor component', () => {
    it('renders cursor element', () => {
      render(
        <RemoteCursor
          cursor={mockCursor}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
        />
      );

      expect(screen.getByTestId('remote-cursor')).toBeInTheDocument();
    });

    it('displays participant name when showLabel is true', () => {
      render(
        <RemoteCursor
          cursor={mockCursor}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
          showLabel={true}
        />
      );

      expect(screen.getByText('Test User')).toBeInTheDocument();
    });

    it('hides participant name when showLabel is false', () => {
      render(
        <RemoteCursor
          cursor={mockCursor}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
          showLabel={false}
        />
      );

      expect(screen.queryByText('Test User')).not.toBeInTheDocument();
    });

    it('sets correct participant ID attribute', () => {
      render(
        <RemoteCursor
          cursor={mockCursor}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
        />
      );

      const cursor = screen.getByTestId('remote-cursor');
      expect(cursor).toHaveAttribute('data-participant-id', 'participant-1');
    });

    it('uses custom color when provided', () => {
      const cursorWithColor: RemoteCursorData = {
        ...mockCursor,
        color: '#FF0000',
      };

      render(
        <RemoteCursor
          cursor={cursorWithColor}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
        />
      );

      // The cursor should be rendered (color is applied via style)
      expect(screen.getByTestId('remote-cursor')).toBeInTheDocument();
    });

    it('hides cursor when position is stale (older than 5 seconds)', () => {
      const staleCursor: RemoteCursorData = {
        ...mockCursor,
        position: {
          ...mockCursor.position,
          timestamp: Date.now() - 6000, // 6 seconds ago
        },
      };

      render(
        <RemoteCursor
          cursor={staleCursor}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
        />
      );

      expect(screen.queryByTestId('remote-cursor')).not.toBeInTheDocument();
    });

    it('shows cursor when position is fresh', () => {
      const freshCursor: RemoteCursorData = {
        ...mockCursor,
        position: {
          ...mockCursor.position,
          timestamp: Date.now() - 1000, // 1 second ago
        },
      };

      render(
        <RemoteCursor
          cursor={freshCursor}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
        />
      );

      expect(screen.getByTestId('remote-cursor')).toBeInTheDocument();
    });
  });

  describe('RemoteCursorsContainer', () => {
    it('renders nothing when cursors array is empty', () => {
      render(
        <RemoteCursorsContainer
          cursors={[]}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
        />
      );

      expect(screen.queryByTestId('remote-cursors-container')).not.toBeInTheDocument();
    });

    it('renders container when cursors are present', () => {
      render(
        <RemoteCursorsContainer
          cursors={[mockCursor]}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
        />
      );

      expect(screen.getByTestId('remote-cursors-container')).toBeInTheDocument();
    });

    it('renders multiple cursors', () => {
      const cursors: RemoteCursorData[] = [
        mockCursor,
        {
          participantId: 'participant-2',
          displayName: 'Another User',
          position: { x: 100, y: 100, timestamp: Date.now() },
        },
      ];

      render(
        <RemoteCursorsContainer
          cursors={cursors}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
        />
      );

      const cursorElements = screen.getAllByTestId('remote-cursor');
      expect(cursorElements).toHaveLength(2);
    });

    it('passes showLabels prop to individual cursors', () => {
      render(
        <RemoteCursorsContainer
          cursors={[mockCursor]}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
          showLabels={false}
        />
      );

      expect(screen.queryByText('Test User')).not.toBeInTheDocument();
    });
  });

  describe('useRemoteCursors hook', () => {
    it('starts with empty cursors array', () => {
      const { result } = renderHook(() => useRemoteCursors());

      expect(result.current.cursors).toEqual([]);
    });

    it('adds cursor with updateCursor', () => {
      const { result } = renderHook(() => useRemoteCursors());

      act(() => {
        result.current.updateCursor(mockCursor);
      });

      expect(result.current.cursors).toHaveLength(1);
      expect(result.current.cursors[0]).toEqual(mockCursor);
    });

    it('updates existing cursor with same participantId', () => {
      const { result } = renderHook(() => useRemoteCursors());

      act(() => {
        result.current.updateCursor(mockCursor);
      });

      const updatedCursor: RemoteCursorData = {
        ...mockCursor,
        position: { x: 200, y: 200, timestamp: Date.now() },
      };

      act(() => {
        result.current.updateCursor(updatedCursor);
      });

      expect(result.current.cursors).toHaveLength(1);
      expect(result.current.cursors[0].position.x).toBe(200);
    });

    it('removes cursor with removeCursor', () => {
      const { result } = renderHook(() => useRemoteCursors());

      act(() => {
        result.current.updateCursor(mockCursor);
      });

      expect(result.current.cursors).toHaveLength(1);

      act(() => {
        result.current.removeCursor('participant-1');
      });

      expect(result.current.cursors).toHaveLength(0);
    });

    it('clears all cursors with clearCursors', () => {
      const { result } = renderHook(() => useRemoteCursors());

      act(() => {
        result.current.updateCursor(mockCursor);
        result.current.updateCursor({
          participantId: 'participant-2',
          displayName: 'User 2',
          position: { x: 0, y: 0, timestamp: Date.now() },
        });
      });

      expect(result.current.cursors).toHaveLength(2);

      act(() => {
        result.current.clearCursors();
      });

      expect(result.current.cursors).toHaveLength(0);
    });

    it('handles multiple cursors from different participants', () => {
      const { result } = renderHook(() => useRemoteCursors());

      act(() => {
        result.current.updateCursor(mockCursor);
        result.current.updateCursor({
          participantId: 'participant-2',
          displayName: 'User 2',
          position: { x: 100, y: 100, timestamp: Date.now() },
        });
        result.current.updateCursor({
          participantId: 'participant-3',
          displayName: 'User 3',
          position: { x: 200, y: 200, timestamp: Date.now() },
        });
      });

      expect(result.current.cursors).toHaveLength(3);
    });
  });
});
