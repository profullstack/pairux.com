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
    <div className="border-border border-b">
      {/* Header */}
      <button
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        className="px-4 py-2 hover:bg-muted flex w-full items-center justify-between transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="gap-2 flex items-center">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Participants</span>
          <span className="bg-muted px-1.5 py-0.5 text-xs text-muted-foreground rounded-full">
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
        <div className="max-h-48 px-1 pb-2 overflow-y-auto">
          {isLoading ? (
            <div className="py-4 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : participants.length === 0 ? (
            <div className="py-4 text-sm text-muted-foreground text-center">
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
