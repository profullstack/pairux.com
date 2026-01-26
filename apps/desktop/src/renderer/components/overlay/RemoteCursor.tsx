import { useEffect, useState, useRef, useCallback } from 'react';

export interface CursorPosition {
  x: number;
  y: number;
  timestamp: number;
}

export interface RemoteCursorData {
  participantId: string;
  displayName: string;
  position: CursorPosition;
  color?: string;
}

interface RemoteCursorProps {
  /** Cursor data including position and participant info */
  cursor: RemoteCursorData;
  /** Container dimensions for scaling cursor position */
  containerDimensions: { width: number; height: number };
  /** Original screen dimensions the cursor was captured from */
  sourceDimensions: { width: number; height: number };
  /** Whether to show the participant name */
  showLabel?: boolean;
  /** Animation smoothing (0-1, higher = smoother) */
  smoothing?: number;
}

// Predefined colors for cursors
const CURSOR_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
];

/**
 * Get a consistent color for a participant based on their ID
 */
export function getCursorColor(participantId: string): string {
  let hash = 0;
  for (let i = 0; i < participantId.length; i++) {
    hash = participantId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

/**
 * RemoteCursor component displays a remote user's cursor position
 */
export function RemoteCursor({
  cursor,
  containerDimensions,
  sourceDimensions,
  showLabel = true,
  smoothing = 0.15,
}: RemoteCursorProps) {
  const [displayPosition, setDisplayPosition] = useState({ x: 0, y: 0 });
  const animationRef = useRef<number | undefined>(undefined);
  const targetRef = useRef({ x: 0, y: 0 });

  const color = cursor.color ?? getCursorColor(cursor.participantId);

  // Scale cursor position from source dimensions to container dimensions
  const scalePosition = useCallback(
    (pos: CursorPosition) => {
      const scaleX = containerDimensions.width / sourceDimensions.width;
      const scaleY = containerDimensions.height / sourceDimensions.height;
      return {
        x: pos.x * scaleX,
        y: pos.y * scaleY,
      };
    },
    [containerDimensions, sourceDimensions]
  );

  // Update target position when cursor data changes
  useEffect(() => {
    const scaled = scalePosition(cursor.position);
    targetRef.current = scaled;
  }, [cursor.position, scalePosition]);

  // Smooth animation loop
  useEffect(() => {
    const animate = () => {
      setDisplayPosition((prev) => ({
        x: prev.x + (targetRef.current.x - prev.x) * smoothing,
        y: prev.y + (targetRef.current.y - prev.y) * smoothing,
      }));
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [smoothing]);

  // Hide cursor if position is stale (older than 5 seconds)
  const isStale = Date.now() - cursor.position.timestamp > 5000;
  if (isStale) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute transition-opacity"
      style={{
        left: displayPosition.x,
        top: displayPosition.y,
        transform: 'translate(-2px, -2px)',
      }}
      data-testid="remote-cursor"
      data-participant-id={cursor.participantId}
    >
      {/* Cursor pointer SVG */}
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="drop-shadow-md">
        <path
          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.54.35-.85L6.35 2.86c-.31-.31-.85-.1-.85.35z"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
        />
      </svg>

      {/* Participant label */}
      {showLabel && (
        <div
          className="ml-4 mt-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-white shadow-md"
          style={{ backgroundColor: color }}
        >
          {cursor.displayName}
        </div>
      )}
    </div>
  );
}

interface RemoteCursorsContainerProps {
  /** Array of cursor data from remote participants */
  cursors: RemoteCursorData[];
  /** Container dimensions for scaling */
  containerDimensions: { width: number; height: number };
  /** Source screen dimensions */
  sourceDimensions: { width: number; height: number };
  /** Whether to show labels */
  showLabels?: boolean;
}

/**
 * Container for rendering multiple remote cursors
 */
export function RemoteCursorsContainer({
  cursors,
  containerDimensions,
  sourceDimensions,
  showLabels = true,
}: RemoteCursorsContainerProps) {
  if (cursors.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-testid="remote-cursors-container"
    >
      {cursors.map((cursor) => (
        <RemoteCursor
          key={cursor.participantId}
          cursor={cursor}
          containerDimensions={containerDimensions}
          sourceDimensions={sourceDimensions}
          showLabel={showLabels}
        />
      ))}
    </div>
  );
}

/**
 * Hook for managing remote cursor positions
 */
export function useRemoteCursors() {
  const [cursors, setCursors] = useState<Map<string, RemoteCursorData>>(new Map());

  /**
   * Update a cursor position
   */
  const updateCursor = (data: RemoteCursorData) => {
    setCursors((prev) => {
      const next = new Map(prev);
      next.set(data.participantId, data);
      return next;
    });
  };

  /**
   * Remove a cursor (e.g., when participant leaves)
   */
  const removeCursor = (participantId: string) => {
    setCursors((prev) => {
      const next = new Map(prev);
      next.delete(participantId);
      return next;
    });
  };

  /**
   * Clear all cursors
   */
  const clearCursors = () => {
    setCursors(new Map());
  };

  /**
   * Get cursors as array for rendering
   */
  const getCursorsArray = (): RemoteCursorData[] => {
    return Array.from(cursors.values());
  };

  return {
    cursors: getCursorsArray(),
    updateCursor,
    removeCursor,
    clearCursors,
  };
}
