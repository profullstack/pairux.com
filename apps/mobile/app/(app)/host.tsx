/**
 * Host screen — create a new session and start screen sharing.
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { sessionApi } from '@/lib/api/sessions';

export default function HostScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allowGuestControl, setAllowGuestControl] = useState(false);

  async function handleCreateSession() {
    setError('');
    setLoading(true);

    try {
      const result = await sessionApi.create({ allowGuestControl });

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.data) {
        router.push({
          pathname: '/(app)/session/[id]',
          params: { id: result.data.id, role: 'host' },
        });
      }
    } catch {
      setError('Failed to create session');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="flex-1 bg-gray-50 px-6 pt-8">
      <Text className="mb-2 text-2xl font-bold text-gray-900">Host a Session</Text>
      <Text className="mb-8 text-gray-500">
        Share your screen with others. They&apos;ll be able to see your screen in real-time.
      </Text>

      {/* Error */}
      {error ? (
        <View className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <Text className="text-sm text-red-600">{error}</Text>
        </View>
      ) : null}

      {/* Settings */}
      <View className="mb-8 rounded-xl border border-gray-200 bg-white p-4">
        <Text className="mb-4 text-sm font-semibold text-gray-500">SESSION SETTINGS</Text>

        <View className="flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="font-medium text-gray-900">Allow guest control</Text>
            <Text className="mt-0.5 text-xs text-gray-400">
              Viewers can request remote control of your screen
            </Text>
          </View>
          <Switch
            value={allowGuestControl}
            onValueChange={setAllowGuestControl}
            trackColor={{ false: '#d1d5db', true: '#93c5fd' }}
            thumbColor={allowGuestControl ? '#2563eb' : '#f3f4f6'}
          />
        </View>
      </View>

      {/* Start button */}
      <TouchableOpacity
        onPress={() => {
          void handleCreateSession();
        }}
        disabled={loading}
        className={`items-center rounded-xl px-6 py-4 ${
          loading ? 'bg-primary-400' : 'bg-primary-600'
        }`}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <>
            <Text className="text-lg font-bold text-white">Start Session</Text>
            <Text className="mt-1 text-sm text-primary-100">
              Screen sharing will begin after creation
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* Info */}
      <View className="mt-6 rounded-xl bg-primary-50 p-4">
        <Text className="text-sm font-medium text-primary-900">How it works</Text>
        <Text className="mt-2 text-sm text-primary-700">
          1. Create a session to get a join code{'\n'}
          2. Share the code with others{'\n'}
          3. Start screen sharing from the session screen{'\n'}
          4. Others can view your screen in real-time
        </Text>
      </View>
    </View>
  );
}
