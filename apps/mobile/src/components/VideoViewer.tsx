/**
 * VideoViewer — RTCView wrapper for displaying a remote WebRTC stream.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { RTCView, type MediaStream } from 'react-native-webrtc';

interface VideoViewerProps {
  stream: MediaStream | null;
  style?: object;
}

export function VideoViewer({ stream, style }: VideoViewerProps) {
  if (!stream) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-900" style={style}>
        <Text className="text-gray-400">Waiting for stream...</Text>
      </View>
    );
  }

  return (
    <RTCView
      streamURL={stream.toURL()}
      style={[{ flex: 1, backgroundColor: '#000' }, style]}
      objectFit="contain"
      zOrder={0}
    />
  );
}
