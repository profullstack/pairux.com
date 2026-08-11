'use client';

import { useMemo } from 'react';
import type { CursorPositionMessage } from '@pairux/shared-types';

interface Cursor {
  participantId: string;
  x: number;
  y: number;
  visible: boolean;
  displayName?: string | undefined;
  color?: string | undefined;
}

interface CursorOverlayProps {
  cursors: Map<string, CursorPositionMessage>;
  participantNames?: Map<string, string>;
  className?: string;
  /**
   * The picture's rectangle inside this overlay, when it is known.
   *
   * Cursor coordinates are normalized against the remote screen, and the
   * remote screen is letterboxed inside the player whenever the aspect ratios
   * differ. Positioning by percentage of the overlay therefore draws the
   * cursor somewhere the guest is not pointing, while their clicks land where
   * they aimed — the cursor and the click disagree, which is worse than having
   * no cursor. Falls back to the full overlay when null, which is correct
   * before the stream reports its dimensions.
   */
  contentRect?: { x: number; y: number; width: number; height: number } | null;
}

// Generate consistent color from participant ID
function getColorFromId(id: string): string {
  const colors = [
    'rgb(239, 68, 68)', // red
    'rgb(249, 115, 22)', // orange
    'rgb(234, 179, 8)', // yellow
    'rgb(34, 197, 94)', // green
    'rgb(20, 184, 166)', // teal
    'rgb(59, 130, 246)', // blue
    'rgb(139, 92, 246)', // violet
    'rgb(236, 72, 153)', // pink
  ];

  // Simple hash function to get consistent color
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  const index = Math.abs(hash) % colors.length;
  const color = colors[index];
  return color ?? 'rgb(59, 130, 246)'; // fallback blue
}

function CursorIcon({ color }: { color: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="drop-shadow-lg"
    >
      <path
        d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.44 0 .66-.53.35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z"
        fill={color}
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CursorOverlay({
  cursors,
  participantNames,
  className = '',
  contentRect = null,
}: CursorOverlayProps) {
  // Convert map to array of cursors with colors
  const cursorList = useMemo(() => {
    const list: Cursor[] = [];
    cursors.forEach((cursor, id) => {
      if (cursor.visible) {
        list.push({
          participantId: id,
          x: cursor.x,
          y: cursor.y,
          visible: cursor.visible,
          displayName: participantNames?.get(id),
          color: getColorFromId(id),
        });
      }
    });
    return list;
  }, [cursors, participantNames]);

  if (cursorList.length === 0) {
    return null;
  }

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {cursorList.map((cursor) => (
        <div
          key={cursor.participantId}
          className="absolute transition-all duration-75 ease-out"
          style={
            contentRect
              ? {
                  left: `${String(contentRect.x + cursor.x * contentRect.width)}px`,
                  top: `${String(contentRect.y + cursor.y * contentRect.height)}px`,
                  transform: 'translate(-2px, -2px)',
                }
              : {
                  left: `${String(cursor.x * 100)}%`,
                  top: `${String(cursor.y * 100)}%`,
                  transform: 'translate(-2px, -2px)',
                }
          }
        >
          <CursorIcon color={cursor.color ?? 'rgb(59, 130, 246)'} />
          {cursor.displayName && (
            <div
              className="mt-1 ml-4 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-white"
              style={{ backgroundColor: cursor.color }}
            >
              {cursor.displayName}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
