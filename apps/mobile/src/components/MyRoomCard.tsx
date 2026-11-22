/**
 * The user's permanent room link on the dashboard: share it, or open it to
 * start the room (the page starts or resumes the room's session).
 */
import { useCallback, useState } from 'react';
import { Linking, Share, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { defaultRoom, roomsApi, type PersonalRoom } from '@/lib/api/rooms';

export function MyRoomCard() {
  const [room, setRoom] = useState<PersonalRoom | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void roomsApi.list().then((result) => {
        if (!cancelled) setRoom(defaultRoom(result.data?.rooms));
      });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (!room) return null;
  const display = room.url.replace(/^https?:\/\//, '');

  return (
    <View className="mx-4 mt-4 rounded-xl border border-primary-100 bg-primary-50 p-4">
      <Text className="text-xs font-semibold text-primary-700">MY ROOM</Text>
      <Text className="mt-1 text-base font-semibold text-primary-700" selectable>
        {display}
      </Text>
      <Text className="mt-1 text-xs text-gray-500">
        Your permanent link. People who open it join you while you are in the room.
      </Text>
      <View className="mt-3 flex-row gap-3">
        <TouchableOpacity
          onPress={() => {
            void Share.share({ message: room.url, url: room.url });
          }}
          className="flex-1 items-center rounded-lg border border-primary-200 bg-white py-2"
        >
          <Text className="text-sm font-medium text-primary-600">Share link</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            void Linking.openURL(room.url);
          }}
          className="flex-1 items-center rounded-lg bg-primary-600 py-2"
        >
          <Text className="text-sm font-medium text-white">Start my room</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
