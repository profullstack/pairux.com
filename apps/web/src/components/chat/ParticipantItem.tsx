'use client';

import { memo } from 'react';
import { User, Crown, MessageCircle } from 'lucide-react';
import type { SessionParticipant } from '@pairux/shared-types';

interface ParticipantItemProps {
  participant: SessionParticipant;
  isCurrentUser: boolean;
  onStartDM?: (participant: SessionParticipant) => void;
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

export const ParticipantItem = memo(function ParticipantItem({
  participant,
  isCurrentUser,
  onStartDM,
}: ParticipantItemProps) {
  const isHost = participant.role === 'host';
  const avatarColor = stringToColor(participant.display_name);

  return (
    <div
      className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-gray-800"
      data-testid="participant-item"
    >
      {/* Avatar */}
      <div
        className={`relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${avatarColor}`}
      >
        <User className="h-3.5 w-3.5 text-white" />
        {isHost && (
          <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-yellow-400">
            <Crown className="h-2.5 w-2.5 text-yellow-800" />
          </div>
        )}
      </div>

      {/* Name and role */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-gray-300">
            {participant.display_name}
          </span>
          {isCurrentUser && <span className="text-xs text-gray-500">(you)</span>}
        </div>
        {isHost && <span className="text-xs text-gray-400">Host</span>}
      </div>

      {/* DM button - only show for other participants */}
      {!isCurrentUser && onStartDM && (
        <button
          onClick={() => {
            onStartDM(participant);
          }}
          className="rounded-md p-1.5 text-gray-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-700 hover:text-gray-300"
          aria-label={`Message ${participant.display_name}`}
          title={`Message ${participant.display_name}`}
        >
          <MessageCircle className="h-4 w-4" />
        </button>
      )}
    </div>
  );
});
