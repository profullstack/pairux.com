import {
  Users,
  Crown,
  Eye,
  Monitor,
  Circle,
  Shield,
  UserX,
  Loader2,
  Mic,
  MicOff,
} from 'lucide-react';
import { useState, useCallback } from 'react';
import type { SessionParticipant } from '@pairux/shared-types';

interface ParticipantListProps {
  participants: SessionParticipant[];
  currentUserId?: string;
  sessionId?: string;
  isHost?: boolean;
  onGrantControl?: (participantId: string) => Promise<void>;
  onRevokeControl?: (participantId: string) => Promise<void>;
  onKickParticipant?: (participantId: string) => Promise<void>;
  onMuteParticipant?: (participantId: string, muted: boolean) => void;
  mutedParticipants?: Set<string>;
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
      <span className="gap-1 bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary flex items-center rounded-full">
        <Crown className="h-3 w-3" />
        Host
      </span>
    );
  }

  if (participant.control_state === 'granted') {
    return (
      <span className="gap-1 bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-500 flex items-center rounded-full">
        <Monitor className="h-3 w-3" />
        In Control
      </span>
    );
  }

  if (participant.control_state === 'requested') {
    return (
      <span className="gap-1 bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-500 flex items-center rounded-full">
        <Eye className="h-3 w-3" />
        Requesting
      </span>
    );
  }

  return (
    <span className="gap-1 bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground flex items-center rounded-full">
      <Eye className="h-3 w-3" />
      Viewer
    </span>
  );
}

export function ParticipantList({
  participants,
  currentUserId,
  isHost = false,
  onGrantControl,
  onRevokeControl,
  onKickParticipant,
  onMuteParticipant,
  mutedParticipants,
}: ParticipantListProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const activeParticipants = participants.filter((p) => !p.left_at);

  const handleGrantControl = useCallback(
    async (participantId: string) => {
      if (!onGrantControl) return;
      setLoadingAction(`grant-${participantId}`);
      try {
        await onGrantControl(participantId);
      } finally {
        setLoadingAction(null);
      }
    },
    [onGrantControl]
  );

  const handleRevokeControl = useCallback(
    async (participantId: string) => {
      if (!onRevokeControl) return;
      setLoadingAction(`revoke-${participantId}`);
      try {
        await onRevokeControl(participantId);
      } finally {
        setLoadingAction(null);
      }
    },
    [onRevokeControl]
  );

  const handleKick = useCallback(
    async (participantId: string) => {
      if (!onKickParticipant) return;
      setLoadingAction(`kick-${participantId}`);
      try {
        await onKickParticipant(participantId);
      } finally {
        setLoadingAction(null);
      }
    },
    [onKickParticipant]
  );

  if (activeParticipants.length === 0) {
    return (
      <div className="rounded-lg border-border bg-muted/50 p-4 border text-center">
        <Users className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="mt-2 text-sm text-muted-foreground">No participants yet</p>
        <p className="text-xs text-muted-foreground">Share your link to invite others</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="gap-2 text-sm font-medium text-foreground flex items-center">
          <Users className="h-4 w-4" />
          Participants
        </h3>
        <span className="text-xs text-muted-foreground">{activeParticipants.length} active</span>
      </div>

      <div className="space-y-1">
        {activeParticipants.map((participant) => {
          const isCurrentUser = participant.user_id === currentUserId;
          const isParticipantHost = participant.role === 'host';
          const showActions = isHost && !isParticipantHost && !isCurrentUser;

          return (
            <div
              key={participant.id}
              className="rounded-lg border-border bg-background px-3 py-2 flex items-center justify-between border"
            >
              <div className="gap-2 flex items-center">
                <div className="relative">
                  <div className="h-8 w-8 bg-muted text-sm font-medium text-foreground flex items-center justify-center rounded-full">
                    {participant.display_name.charAt(0).toUpperCase()}
                  </div>
                  <Circle
                    className={`-bottom-0.5 -right-0.5 h-3 w-3 absolute ${getConnectionColor(participant.connection_status)} border-background rounded-full border-2`}
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
                  <span className="text-xs text-muted-foreground capitalize">
                    {participant.connection_status}
                  </span>
                </div>
              </div>

              <div className="gap-2 flex items-center">
                {getRoleBadge(participant)}

                {/* Host actions */}
                {showActions && (
                  <div className="gap-1 flex">
                    {/* Mute/Unmute button */}
                    {onMuteParticipant &&
                      participant.user_id &&
                      (() => {
                        const userId = participant.user_id;
                        const isMutedNow = mutedParticipants?.has(userId) ?? false;
                        return (
                          <button
                            onClick={() => {
                              onMuteParticipant(userId, !isMutedNow);
                            }}
                            disabled={loadingAction !== null}
                            className={`rounded p-1.5 transition-colors disabled:opacity-50 ${
                              isMutedNow
                                ? 'text-destructive hover:bg-destructive/20'
                                : 'text-muted-foreground hover:bg-muted'
                            }`}
                            title={isMutedNow ? 'Unmute participant' : 'Mute participant'}
                            aria-label={isMutedNow ? 'Unmute participant' : 'Mute participant'}
                          >
                            {isMutedNow ? (
                              <MicOff className="h-4 w-4" />
                            ) : (
                              <Mic className="h-4 w-4" />
                            )}
                          </button>
                        );
                      })()}

                    {/* Grant/Revoke control button */}
                    {participant.control_state === 'granted' ? (
                      <button
                        onClick={() => void handleRevokeControl(participant.id)}
                        disabled={loadingAction !== null}
                        className="rounded p-1.5 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                        title="Revoke control"
                        aria-label="Revoke control"
                      >
                        {loadingAction === `revoke-${participant.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Shield className="h-4 w-4" />
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={() => void handleGrantControl(participant.id)}
                        disabled={loadingAction !== null}
                        className="rounded p-1.5 text-green-500 hover:bg-green-500/20 transition-colors disabled:opacity-50"
                        title="Grant control"
                        aria-label="Grant control"
                      >
                        {loadingAction === `grant-${participant.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Shield className="h-4 w-4" />
                        )}
                      </button>
                    )}

                    {/* Kick button */}
                    <button
                      onClick={() => void handleKick(participant.id)}
                      disabled={loadingAction !== null}
                      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors disabled:opacity-50"
                      title="Remove participant"
                      aria-label="Remove participant"
                    >
                      {loadingAction === `kick-${participant.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserX className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
