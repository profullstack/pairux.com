/**
 * Dashboard screen — recent sessions and quick actions.
 */
import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Session } from '@pairux/shared-types';
import { sessionApi } from '@/lib/api/sessions';
import { useAuth } from '@/contexts/AuthContext';

export default function DashboardScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSessions = useCallback(async () => {
    const result = await sessionApi.list();
    if (result.data) {
      setSessions(result.data);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchSessions();
    }, [fetchSessions])
  );

  function onRefresh() {
    setRefreshing(true);
    void fetchSessions();
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-700';
      case 'ended':
        return 'bg-gray-100 text-gray-500';
      default:
        return 'bg-yellow-100 text-yellow-700';
    }
  }

  return (
    <View className="flex-1 bg-gray-50">
      {/* Welcome banner */}
      <View className="bg-primary-600 px-6 py-6">
        <Text className="text-xl font-bold text-white">
          Welcome{user?.email ? `, ${user.email.split('@')[0]}` : ''}
        </Text>
        <Text className="mt-1 text-primary-100">Share your screen from anywhere</Text>
      </View>

      {/* Quick actions */}
      <View className="flex-row gap-3 px-4 py-4">
        <TouchableOpacity
          onPress={() => {
            router.push('/(app)/host');
          }}
          className="flex-1 items-center rounded-xl bg-primary-600 py-4"
        >
          <Text className="text-lg font-bold text-white">+</Text>
          <Text className="mt-1 text-sm font-medium text-white">Host Session</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            router.push('/(app)/join');
          }}
          className="flex-1 items-center rounded-xl border border-primary-200 bg-white py-4"
        >
          <Text className="text-lg font-bold text-primary-600">{'>'}</Text>
          <Text className="mt-1 text-sm font-medium text-primary-600">Join Session</Text>
        </TouchableOpacity>
      </View>

      {/* Session list */}
      <View className="flex-1 px-4">
        <Text className="mb-3 text-sm font-semibold text-gray-500">RECENT SESSIONS</Text>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#2563eb" />
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2563eb" />
            }
            ListEmptyComponent={
              <View className="items-center py-12">
                <Text className="text-gray-400">No sessions yet</Text>
                <Text className="mt-1 text-sm text-gray-300">
                  Host or join a session to get started
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                className="mb-3 rounded-xl border border-gray-200 bg-white p-4"
                onPress={() => {
                  if (item.status === 'active') {
                    router.push({
                      pathname: '/(app)/session/[id]',
                      params: { id: item.id, role: 'host' },
                    });
                  }
                }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-1">
                    <Text className="font-medium text-gray-900">Session {item.join_code}</Text>
                    <Text className="mt-1 text-xs text-gray-400">
                      {formatDate(item.created_at)}
                    </Text>
                  </View>
                  <View className={`rounded-full px-3 py-1 ${getStatusColor(item.status)}`}>
                    <Text className="text-xs font-medium capitalize">{item.status}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </View>
  );
}
