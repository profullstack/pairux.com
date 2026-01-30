/**
 * Join screen — enter a join code to view someone's screen.
 */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import type { Session } from '@pairux/shared-types';
import { sessionApi } from '@/lib/api/sessions';

export default function JoinScreen() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<Session | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  async function handleLookup() {
    if (!joinCode.trim()) return;
    setError('');
    setLookingUp(true);
    setLookupResult(null);

    try {
      const result = await sessionApi.lookup(joinCode.trim().toUpperCase());

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.data?.session) {
        setLookupResult(result.data.session);
      }
    } catch {
      setError('Failed to look up session');
    } finally {
      setLookingUp(false);
    }
  }

  async function handleJoin() {
    if (!joinCode.trim() || !displayName.trim()) return;
    setError('');
    setLoading(true);

    try {
      const result = await sessionApi.join(joinCode.trim().toUpperCase(), displayName.trim());

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.data) {
        router.push({
          pathname: '/(app)/session/[id]',
          params: {
            id: lookupResult?.id ?? '',
            role: 'viewer',
            participantId: result.data.id,
          },
        });
      }
    } catch {
      setError('Failed to join session');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-gray-50"
    >
      <View className="flex-1 px-6 pt-8">
        <Text className="mb-2 text-2xl font-bold text-gray-900">Join a Session</Text>
        <Text className="mb-8 text-gray-500">Enter the join code shared by the session host.</Text>

        {/* Error */}
        {error ? (
          <View className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <Text className="text-sm text-red-600">{error}</Text>
          </View>
        ) : null}

        {/* Join code */}
        <View className="mb-4">
          <Text className="mb-1 text-sm font-medium text-gray-700">Join Code</Text>
          <View className="flex-row gap-3">
            <TextInput
              value={joinCode}
              onChangeText={(text) => {
                setJoinCode(text.toUpperCase());
                setLookupResult(null);
              }}
              placeholder="ABC123"
              placeholderTextColor="#9ca3af"
              autoCapitalize="characters"
              maxLength={10}
              className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 text-center font-mono text-lg tracking-widest text-gray-900"
            />
            <TouchableOpacity
              onPress={() => {
                void handleLookup();
              }}
              disabled={lookingUp || !joinCode.trim()}
              className={`items-center justify-center rounded-lg px-5 ${
                lookingUp || !joinCode.trim() ? 'bg-gray-300' : 'bg-primary-600'
              }`}
            >
              {lookingUp ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text className="font-medium text-white">Look Up</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Lookup result */}
        {lookupResult ? (
          <View className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4">
            <Text className="font-medium text-green-800">Session found</Text>
            <Text className="mt-1 text-sm text-green-600">
              Status: {lookupResult.status} | Code: {lookupResult.join_code}
            </Text>

            {/* Display name input */}
            <View className="mt-4">
              <Text className="mb-1 text-sm font-medium text-gray-700">Your display name</Text>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Enter your name"
                placeholderTextColor="#9ca3af"
                autoComplete="name"
                className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900"
              />
            </View>

            {/* Join button */}
            <TouchableOpacity
              onPress={() => {
                void handleJoin();
              }}
              disabled={loading || !displayName.trim()}
              className={`mt-4 items-center rounded-lg px-4 py-3 ${
                loading || !displayName.trim() ? 'bg-primary-400' : 'bg-primary-600'
              }`}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text className="font-semibold text-white">Join Session</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Info */}
        <View className="mb-8 mt-auto rounded-xl bg-primary-50 p-4">
          <Text className="text-sm font-medium text-primary-900">Tips</Text>
          <Text className="mt-2 text-sm text-primary-700">
            Ask the host for their join code. It&apos;s usually a short alphanumeric code displayed
            on their screen.
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
