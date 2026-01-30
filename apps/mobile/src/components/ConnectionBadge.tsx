/**
 * ConnectionBadge — displays WebRTC connection status.
 */
import React from 'react';
import { View, Text } from 'react-native';
import type { ConnectionState, NetworkQuality } from '@pairux/shared-types';

interface ConnectionBadgeProps {
  connectionState: ConnectionState;
  networkQuality?: NetworkQuality;
}

function getStateColor(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'bg-green-500';
    case 'connecting':
    case 'reconnecting':
      return 'bg-yellow-500';
    case 'failed':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
}

function getStateLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting...';
    case 'reconnecting':
      return 'Reconnecting...';
    case 'failed':
      return 'Failed';
    case 'disconnected':
      return 'Disconnected';
    default:
      return 'Idle';
  }
}

function getQualityLabel(quality: NetworkQuality): string {
  switch (quality) {
    case 'excellent':
      return 'Excellent';
    case 'good':
      return 'Good';
    case 'poor':
      return 'Poor';
    case 'bad':
      return 'Bad';
  }
}

export function ConnectionBadge({ connectionState, networkQuality }: ConnectionBadgeProps) {
  return (
    <View className="flex-row items-center gap-2 rounded-full bg-black/60 px-3 py-1.5">
      <View className={`h-2 w-2 rounded-full ${getStateColor(connectionState)}`} />
      <Text className="text-xs font-medium text-white">{getStateLabel(connectionState)}</Text>
      {connectionState === 'connected' && networkQuality && (
        <Text className="text-xs text-gray-300">({getQualityLabel(networkQuality)})</Text>
      )}
    </View>
  );
}
