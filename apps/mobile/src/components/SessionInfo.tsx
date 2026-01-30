/**
 * SessionInfo — displays join code, copy action, and viewer count.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';

interface SessionInfoProps {
  joinCode: string;
  viewerCount: number;
  isHosting: boolean;
}

export function SessionInfo({ joinCode, viewerCount, isHosting }: SessionInfoProps) {
  async function copyJoinCode() {
    await Clipboard.setStringAsync(joinCode);
    Alert.alert('Copied', `Join code "${joinCode}" copied to clipboard`);
  }

  return (
    <View className="flex-row items-center justify-between bg-gray-900 px-4 py-3">
      <View className="flex-row items-center gap-3">
        <TouchableOpacity
          onPress={() => {
            void copyJoinCode();
          }}
          className="flex-row items-center gap-2 rounded-lg bg-gray-800 px-3 py-2"
        >
          <Text className="font-mono text-base font-bold tracking-widest text-white">
            {joinCode}
          </Text>
          <Text className="text-xs text-gray-400">Copy</Text>
        </TouchableOpacity>
      </View>

      <View className="flex-row items-center gap-3">
        {isHosting && (
          <View className="flex-row items-center gap-1.5 rounded-full bg-green-900/50 px-3 py-1">
            <View className="h-2 w-2 rounded-full bg-green-500" />
            <Text className="text-xs font-medium text-green-400">Live</Text>
          </View>
        )}
        <View className="flex-row items-center gap-1">
          <Text className="text-sm text-gray-400">
            {viewerCount} viewer{viewerCount !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
    </View>
  );
}
