'use client';

import { memo, useEffect, useRef } from 'react';
import { User, Crown } from 'lucide-react';
import type { SessionParticipant } from '@pairux/shared-types';

interface MentionAutocompleteProps {
  participants: SessionParticipant[];
  query: string;
  onSelect: (participant: SessionParticipant) => void;
  onClose: () => void;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
}

// Generate a consistent color from a string (same as ChatMessage)
function stringToColor(str: string): string {
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-teal-500',
    'bg-indigo-500',
    'bg-cyan-500',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length] ?? 'bg-gray-500';
}

export const MentionAutocomplete = memo(function MentionAutocomplete({
  participants,
  query,
  onSelect,
  onClose,
  selectedIndex,
  onSelectedIndexChange,
}: MentionAutocompleteProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Filter participants by query
  const filteredParticipants = participants.filter((p) =>
    p.display_name.toLowerCase().includes(query.toLowerCase())
  );

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      selectedElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Handle click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (listRef.current && !listRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Update selected index when filtered list changes
  useEffect(() => {
    if (selectedIndex >= filteredParticipants.length) {
      onSelectedIndexChange(Math.max(0, filteredParticipants.length - 1));
    }
  }, [filteredParticipants.length, selectedIndex, onSelectedIndexChange]);

  if (filteredParticipants.length === 0) {
    return (
      <div
        ref={listRef}
        className="absolute bottom-full left-0 mb-1 w-64 rounded-lg border border-gray-700 bg-gray-800 p-2 shadow-lg"
      >
        <p className="text-sm text-gray-400">No matching participants</p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 mb-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 shadow-lg"
      role="listbox"
    >
      {filteredParticipants.map((participant, index) => {
        const isHost = participant.role === 'host';
        const avatarColor = stringToColor(participant.display_name);
        const isSelected = index === selectedIndex;

        return (
          <button
            key={participant.id}
            onClick={() => {
              onSelect(participant);
            }}
            onMouseEnter={() => {
              onSelectedIndexChange(index);
            }}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
              isSelected ? 'bg-primary-900/50' : 'hover:bg-gray-700'
            }`}
            role="option"
            aria-selected={isSelected}
          >
            {/* Avatar */}
            <div
              className={`relative flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${avatarColor}`}
            >
              <User className="h-3 w-3 text-white" />
              {isHost && (
                <div className="absolute -top-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-yellow-400">
                  <Crown className="h-2 w-2 text-yellow-800" />
                </div>
              )}
            </div>

            {/* Name */}
            <span className="flex-1 truncate text-sm font-medium text-gray-300">
              {participant.display_name}
            </span>

            {isHost && <span className="text-xs text-gray-500">Host</span>}
          </button>
        );
      })}
    </div>
  );
});
