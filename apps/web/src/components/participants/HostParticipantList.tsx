'use client';

import { memo, useMemo } from 'react';
import { Users, Crown, Eye, Monitor, Circle, Shield, UserX } from 'lucide-react';
import type { SessionParticipant, ConnectionStatus, ControlState } from '@pairux/shared-types';
import type { ViewerConnection } from '@/hooks/useWebRTCHost';

interface HostParticipantListProps {
  participants: SessionParticipant[];
  viewers: Map<string, ViewerConnection>;
  currentUserId?: string;
  onGrantControl: (viewerId: string) => void;
  onRevokeControl: (viewerId: string) => void;
  onKickParticipant: (viewerId: string) => void;
}

interface EnhancedParticipant extends SessionParticipant {
  webrtcConnected: boolean;
  effectiveConnectionStatus: ConnectionStatus;
  effectiveControlState: ControlState;
  dataChannelReady: boolean;
  viewerId: string | null;
}

function getConnectionColor(status: ConnectionStatus): string {
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

function mapWebRTCStateToConnectionStatus(
  state: ViewerConnection['connectionState']
): ConnectionStatus {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'connecting':
    case 'reconnecting':
      return 'reconnecting';
    default:
      return 'disconnected';
  }
}

const HostParticipantItem = memo(function HostParticipantItem({
  participant,
  isCurrentUser,
  onGrantControl,
  onRevokeControl,
  onKick,
}: {
  participant: EnhancedParticipant;
  isCurrentUser: boolean;
  onGrantControl: (viewerId: string) => void;
  onRevokeControl: (viewerId: string) => void;
  onKick: (viewerId: string) => void;
}) {
  const isHost = participant.role === 'host';
  const canControl = participant.viewerId && participant.dataChannelReady;

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 px-3 py-2">
      <div className="flex items-center gap-2">
        {/* Avatar with connection status */}
        <div className="relative">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700 text-sm font-medium text-white">
            {participant.display_name.charAt(0).toUpperCase()}
          </div>
          <Circle
            className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 ${getConnectionColor(participant.effectiveConnectionStatus)} rounded-full border-2 border-gray-800`}
            fill="currentColor"
          />
        </div>

        {/* Name and status */}
        <div className="flex flex-col">
          <span className="text-sm font-medium text-white">
            {participant.display_name}
            {isCurrentUser && <span className="ml-1 text-xs text-gray-400">(you)</span>}
          </span>
          <span className="text-xs text-gray-400 capitalize">
            {participant.effectiveConnectionStatus}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Role/Control badge */}
        {isHost ? (
          <span className="flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400">
            <Crown className="h-3 w-3" />
            Host
          </span>
        ) : participant.effectiveControlState === 'granted' ? (
          <span className="flex items-center gap-1 rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
            <Monitor className="h-3 w-3" />
            In Control
          </span>
        ) : participant.effectiveControlState === 'requested' ? (
          <span className="flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400">
            <Eye className="h-3 w-3" />
            Requesting
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-gray-600/50 px-2 py-0.5 text-xs font-medium text-gray-400">
            <Eye className="h-3 w-3" />
            Viewer
          </span>
        )}

        {/* Action buttons (only for non-host participants) */}
        {!isHost && !isCurrentUser && (
          <div className="flex gap-1">
            {/* Grant/Revoke control button */}
            {participant.effectiveControlState === 'granted' ? (
              <button
                onClick={() => {
                  if (participant.viewerId) onRevokeControl(participant.viewerId);
                }}
                disabled={!canControl}
                className="rounded p-1.5 text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                title="Revoke control"
                aria-label="Revoke control"
              >
                <Shield className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => {
                  if (participant.viewerId) onGrantControl(participant.viewerId);
                }}
                disabled={!canControl}
                className="rounded p-1.5 text-green-400 transition-colors hover:bg-green-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                title="Grant control"
                aria-label="Grant control"
              >
                <Shield className="h-4 w-4" />
              </button>
            )}

            {/* Kick button */}
            <button
              onClick={() => {
                if (participant.viewerId) onKick(participant.viewerId);
              }}
              disabled={!participant.viewerId}
              className="rounded p-1.5 text-gray-400 transition-colors hover:bg-red-500/20 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              title="Remove participant"
              aria-label="Remove participant"
            >
              <UserX className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export const HostParticipantList = memo(function HostParticipantList({
  participants,
  viewers,
  currentUserId,
  onGrantControl,
  onRevokeControl,
  onKickParticipant,
}: HostParticipantListProps) {
  // Merge database participants with WebRTC viewer state
  const enhancedParticipants = useMemo((): EnhancedParticipant[] => {
    const activeParticipants = participants.filter((p) => !p.left_at);

    return activeParticipants.map((participant) => {
      // Try to find matching viewer by user_id
      // Viewers track presence with their user_id
      let viewer: ViewerConnection | undefined;
      let viewerId: string | null = null;

      // Look through viewers to find one matching this participant
      for (const [id, v] of viewers.entries()) {
        // The viewer ID in the map is the user_id they're tracking with
        if (id === participant.user_id || id === participant.id) {
          viewer = v;
          viewerId = id;
          break;
        }
      }

      return {
        ...participant,
        webrtcConnected: viewer?.connectionState === 'connected',
        effectiveConnectionStatus: viewer
          ? mapWebRTCStateToConnectionStatus(viewer.connectionState)
          : participant.connection_status,
        effectiveControlState: viewer
          ? (viewer.controlState as ControlState)
          : participant.control_state,
        dataChannelReady: viewer?.dataChannel?.readyState === 'open',
        viewerId,
      };
    });
  }, [participants, viewers]);

  // Sort: host first, then by control state, then by name
  const sortedParticipants = useMemo(() => {
    return [...enhancedParticipants].sort((a, b) => {
      if (a.role === 'host' && b.role !== 'host') return -1;
      if (a.role !== 'host' && b.role === 'host') return 1;
      if (a.effectiveControlState === 'granted' && b.effectiveControlState !== 'granted') return -1;
      if (a.effectiveControlState !== 'granted' && b.effectiveControlState === 'granted') return 1;
      if (a.effectiveControlState === 'requested' && b.effectiveControlState === 'view-only')
        return -1;
      if (a.effectiveControlState === 'view-only' && b.effectiveControlState === 'requested')
        return 1;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [enhancedParticipants]);

  if (sortedParticipants.length === 0) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 text-center">
        <Users className="mx-auto h-8 w-8 text-gray-500" />
        <p className="mt-2 text-sm text-gray-400">No participants yet</p>
        <p className="text-xs text-gray-500">Share your link to invite others</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-white">
          <Users className="h-4 w-4" />
          Participants
        </h3>
        <span className="text-xs text-gray-400">{sortedParticipants.length} active</span>
      </div>

      <div className="space-y-1">
        {sortedParticipants.map((participant) => (
          <HostParticipantItem
            key={participant.id}
            participant={participant}
            isCurrentUser={participant.user_id === currentUserId}
            onGrantControl={onGrantControl}
            onRevokeControl={onRevokeControl}
            onKick={onKickParticipant}
          />
        ))}
      </div>
    </div>
  );
});
