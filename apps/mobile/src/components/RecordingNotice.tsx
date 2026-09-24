/**
 * Told to everyone in a call whose host turned on AI call analysis; stays up
 * for the whole call. (Web twin: apps/web/src/components/session/RecordingNotice.tsx.)
 */
import React from 'react';
import { View, Text } from 'react-native';
import type { CallAnalysisSettings } from '@pairux/shared-types';

export function RecordingNotice({
  settings,
}: {
  settings: { analysis?: CallAnalysisSettings | undefined } | null | undefined;
}) {
  const analysis = settings?.analysis;
  if (analysis?.enabled !== true) return null;
  return (
    <View className="bg-violet-900 px-4 py-2" testID="recording-notice" accessibilityRole="alert">
      <Text className="text-center text-xs text-violet-100">
        This call is being recorded for AI analysis by the host
        {analysis.keepRecording ? ', who will keep the recording' : ''}. Leave the call if you do
        not want to take part.
      </Text>
    </View>
  );
}
