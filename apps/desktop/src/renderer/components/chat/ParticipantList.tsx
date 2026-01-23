import { useState, memo } from 'react';
import { Users, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { ParticipantItem } from './ParticipantItem';
import type { SessionParticipant } from '@pairux/shared-types';

interface ParticipantListProps {
  participants: SessionParticipant[];
  currentUserId?: string | null;
  currentParticipantId?: string | null;
  isLoading?: boolean;
  onStartDM?: (participant: SessionParticipant) => void;
  defaultExpanded?: boolean;
}

export const ParticipantList = memo(function ParticipantList({
  participants,
  currentUserId,
  currentParticipantId,
  isLoading = false,
  onStartDM,
  defaultExpanded = true,
}: ParticipantListProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const isCurrentUser = (participant: SessionParticipant): boolean => {
    if (currentUserId && participant.user_id === currentUserId) return true;
    if (currentParticipantId && participant.id === currentParticipantId) return true;
    return false;
  };

  return (
    <div className="border-b border-border">
      {/* Header */}
      <button
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        className="flex w-full items-center justify-between px-4 py-2 transition-colors hover:bg-muted"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Participants</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {participants.length}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Participant list */}
      {isExpanded && (
        <div className="max-h-48 overflow-y-auto px-1 pb-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : participants.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No participants yet
            </div>
          ) : (
            participants.map((participant) => (
              <ParticipantItem
                key={participant.id}
                participant={participant}
                isCurrentUser={isCurrentUser(participant)}
                onStartDM={onStartDM}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
});
