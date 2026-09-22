import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Text, TouchableOpacity, View } from 'react-native';
import type { MicrophoneFailure } from '../lib/microphone';

export function MicrophoneNotice({
  failure,
  unmuteRequested = false,
}: {
  failure: MicrophoneFailure | null;
  unmuteRequested?: boolean;
}) {
  const [settingsFailed, setSettingsFailed] = useState(false);
  const settingsContext = useRef({ attempt: 0, active: true });
  useEffect(() => {
    const context = { attempt: 0, active: true };
    settingsContext.current = context;
    setSettingsFailed(false);
    return () => {
      context.active = false;
    };
  }, [failure]);
  if (!failure && !unmuteRequested) return null;
  return (
    <View className="border-t border-gray-800 bg-gray-900 px-4 py-2">
      <Text accessibilityRole="alert" className="text-sm text-gray-200">
        {failure === 'permission'
          ? 'Microphone permission denied. Listen-only mode.'
          : failure
            ? 'Microphone unavailable. Listen-only mode.'
            : 'The host requested unmute. Your microphone is still muted.'}
      </Text>
      {failure === 'permission' && (Platform.OS === 'ios' || Platform.OS === 'android') && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open microphone settings"
          className="min-h-11 justify-center self-start py-2"
          onPress={() => {
            setSettingsFailed(false);
            const context = settingsContext.current;
            const attempt = ++context.attempt;
            void Linking.openSettings().catch(() => {
              if (context.active && attempt === context.attempt) setSettingsFailed(true);
            });
          }}
        >
          <Text className="text-sm text-blue-300">Open Settings</Text>
        </TouchableOpacity>
      )}
      {failure === 'permission' && settingsFailed && (
        <Text className="text-sm text-gray-200">Could not open Settings.</Text>
      )}
    </View>
  );
}
