import { Users, Crown, Eye, Monitor, Circle } from 'lucide-react';
import type { SessionParticipant } from '@pairux/shared-types';

interface ParticipantListProps {
  participants: SessionParticipant[];
  currentUserId?: string;
}

function getConnectionColor(status: SessionParticipant['connection_status']): string {
  switch (status) {
    case 'connected':
      return 'bg-green-500';
    case 'reconnecting':
      return 'bg-yellow-500';
    case 'disconnected':
      return 'bg-gray-500';
    default:
      return 'bg-gray-500';
  }
}

function getRoleBadge(participant: SessionParticipant) {
  if (participant.role === 'host') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
        <Crown className="h-3 w-3" />
        Host
      </span>
    );
  }

  if (participant.control_state === 'granted') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-500">
        <Monitor className="h-3 w-3" />
        In Control
      </span>
    );
  }

  if (participant.control_state === 'requested') {
    return (
      <span className="flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-500">
        <Eye className="h-3 w-3" />
        Requesting
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Eye className="h-3 w-3" />
      Viewer
    </span>
  );
}

export function ParticipantList({ participants, currentUserId }: ParticipantListProps) {
  const activeParticipants = participants.filter((p) => !p.left_at);

  if (activeParticipants.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/50 p-4 text-center">
        <Users className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">No participants yet</p>
        <p className="text-xs text-muted-foreground">Share your link to invite others</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Users className="h-4 w-4" />
          Participants
        </h3>
        <span className="text-xs text-muted-foreground">{activeParticipants.length} active</span>
      </div>

      <div className="space-y-1">
        {activeParticipants.map((participant) => {
          const isCurrentUser = participant.user_id === currentUserId;

          return (
            <div
              key={participant.id}
              className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <div className="relative">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
                    {participant.display_name.charAt(0).toUpperCase()}
                  </div>
                  <Circle
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 ${getConnectionColor(participant.connection_status)} rounded-full border-2 border-background`}
                    fill="currentColor"
                  />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {participant.display_name}
                    {isCurrentUser && (
                      <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                    )}
                  </span>
                  <span className="text-xs capitalize text-muted-foreground">
                    {participant.connection_status}
                  </span>
                </div>
              </div>
              {getRoleBadge(participant)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
