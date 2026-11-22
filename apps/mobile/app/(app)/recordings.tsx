/**
 * Recordings — the user's cloud recordings and the edits made from them.
 * Polls every 3 s while any edit is still rendering.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Share,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatTime } from '@pairux/video-edit';
import { recordingsApi, type Recording } from '@/lib/api/recordings';
import { anyProcessing, formatBytes, pct } from '@/lib/recording-editor';

const POLL_MS = 3000;

function statusClasses(status: Recording['status']): string {
  switch (status) {
    case 'ready':
      return 'bg-green-100 text-green-700';
    case 'failed':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-yellow-100 text-yellow-700';
  }
}

export default function RecordingsScreen() {
  const router = useRouter();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);

  const load = useCallback(async () => {
    const result = await recordingsApi.list();
    if (result.data) {
      setRecordings(result.data.recordings);
      setError(null);
    } else if (result.error) {
      setError(result.error);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void load();
      return () => {
        focused.current = false;
      };
    }, [load])
  );

  const processing = anyProcessing(recordings);
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => {
      if (focused.current) void load();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [processing, load]);

  function confirmDelete(rec: Recording) {
    Alert.alert('Delete this edit?', 'The original recording is kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void recordingsApi.remove(rec.id).then((r) => {
            if (r.error) Alert.alert('Could not delete', r.error);
            void load();
          });
        },
      },
    ]);
  }

  function renderItem({ item }: { item: Recording }) {
    const title = item.subject?.trim()
      ? item.subject.trim()
      : item.parent_recording_id
        ? 'Edited recording'
        : 'Recording';
    const meta = [
      new Date(item.created_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      item.duration_seconds ? formatTime(item.duration_seconds, 0) : null,
      formatBytes(item.size_bytes) || null,
    ]
      .filter(Boolean)
      .join(' · ');
    const progress =
      item.status === 'processing' && item.edit_progress !== null
        ? Math.round(item.edit_progress * 100)
        : null;
    return (
      <TouchableOpacity
        className="mb-3 rounded-xl border border-gray-200 bg-white p-4"
        disabled={item.status !== 'ready'}
        onPress={() => {
          router.push({ pathname: '/(app)/edit/[id]', params: { id: item.id } });
        }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="font-medium text-gray-900" numberOfLines={1}>
              {item.parent_recording_id ? '✂ ' : ''}
              {title}
            </Text>
            <Text className="mt-1 text-xs text-gray-400">{meta}</Text>
          </View>
          <View className={`rounded-full px-3 py-1 ${statusClasses(item.status)}`}>
            <Text className="text-xs font-medium capitalize">
              {progress !== null ? `${String(progress)}%` : item.status}
            </Text>
          </View>
        </View>
        {progress !== null && (
          <View className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <View className="h-full bg-primary-600" style={{ width: pct(progress / 100) }} />
          </View>
        )}
        {item.status === 'failed' && item.edit_error ? (
          <Text className="mt-2 text-xs text-red-600">{item.edit_error}</Text>
        ) : null}
        {item.status === 'ready' && (
          <View className="mt-3 flex-row gap-2">
            <TouchableOpacity
              className="rounded-lg bg-primary-600 px-3 py-2"
              onPress={() => {
                router.push({ pathname: '/(app)/edit/[id]', params: { id: item.id } });
              }}
            >
              <Text className="text-xs font-semibold text-white">Edit</Text>
            </TouchableOpacity>
            {item.playback_url ? (
              <TouchableOpacity
                className="rounded-lg border border-gray-200 px-3 py-2"
                onPress={() => {
                  void Share.share({
                    message: item.playback_url ?? '',
                    url: item.playback_url ?? '',
                  });
                }}
              >
                <Text className="text-xs font-semibold text-gray-700">Share</Text>
              </TouchableOpacity>
            ) : null}
            {item.parent_recording_id ? (
              <TouchableOpacity
                className="rounded-lg border border-red-200 px-3 py-2"
                onPress={() => {
                  confirmDelete(item);
                }}
              >
                <Text className="text-xs font-semibold text-red-600">Delete</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <View className="flex-1 bg-gray-50 px-4 pt-4">
      <Text className="mb-3 text-sm font-semibold text-gray-500">YOUR RECORDINGS</Text>
      {error ? <Text className="mb-3 text-sm text-red-600">{error}</Text> : null}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : (
        <FlatList
          data={recordings}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor="#2563eb"
            />
          }
          ListEmptyComponent={
            <View className="items-center py-12">
              <Text className="text-gray-400">No recordings yet</Text>
              <Text className="mt-1 text-center text-sm text-gray-300">
                Recorded sessions show up here, ready to trim and share
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
