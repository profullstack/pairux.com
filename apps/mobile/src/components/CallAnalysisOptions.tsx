/**
 * AI call analysis, chosen on the host screen before the session starts.
 * Turning it on turns "Record the call" on with it.
 */
import React from 'react';
import { View, Text, Switch, TouchableOpacity } from 'react-native';
import type { CallAnalysisKind, CallAnalysisSettings } from '@pairux/shared-types';

export const DEFAULT_ANALYSIS: CallAnalysisSettings = {
  enabled: false,
  kind: 'general',
  keepRecording: true,
};

const KINDS: { kind: CallAnalysisKind; label: string }[] = [
  { kind: 'general', label: 'General' },
  { kind: 'interview', label: 'Interview' },
  { kind: 'team-sync', label: 'Team sync' },
  { kind: 'presentation', label: 'Presentation' },
];

export function CallAnalysisOptions({
  value,
  onChange,
}: {
  value: CallAnalysisSettings;
  onChange: (next: CallAnalysisSettings) => void;
}) {
  return (
    <View className="mt-4 border-t border-gray-100 pt-4" testID="analysis-options">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-medium text-gray-900">AI call analysis (Pro)</Text>
          <Text className="mt-0.5 text-xs text-gray-400">
            Feedback after the call: talk time, pace, filler words, what to practice. On a phone
            only your microphone is recorded.
          </Text>
        </View>
        <Switch
          value={value.enabled}
          onValueChange={(on) => {
            onChange(
              on ? { ...value, enabled: true, keepRecording: true } : { ...value, enabled: false }
            );
          }}
          trackColor={{ false: '#d1d5db', true: '#c4b5fd' }}
          thumbColor={value.enabled ? '#7c3aed' : '#f3f4f6'}
          accessibilityLabel="Analyze this call"
        />
      </View>

      {value.enabled && (
        <View className="mt-3">
          <View className="flex-row flex-wrap gap-2">
            {KINDS.map(({ kind, label }) => (
              <TouchableOpacity
                key={kind}
                onPress={() => {
                  onChange({ ...value, kind });
                }}
                className={`rounded-full px-3 py-1 ${value.kind === kind ? 'bg-violet-600' : 'bg-gray-100'}`}
              >
                <Text className={value.kind === kind ? 'text-white' : 'text-gray-700'}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View className="mt-3 flex-row items-center justify-between">
            <Text className="flex-1 text-sm text-gray-700">
              Record the call and keep the recording
            </Text>
            <Switch
              value={value.keepRecording}
              onValueChange={(keepRecording) => {
                onChange({ ...value, keepRecording });
              }}
            />
          </View>
          <Text className="mt-2 text-xs text-gray-400">
            Everyone who joins is told the call is recorded for AI analysis.
          </Text>
        </View>
      )}
    </View>
  );
}
