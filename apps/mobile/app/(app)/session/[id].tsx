/**
 * Active session screen — host or viewer mode with WebRTC and chat.
 *
 * Route params:
 *  - id: session ID
 *  - role: 'host' | 'viewer'
 *  - participantId: viewer's participant ID (viewer mode only)
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator, Platform } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useWebRTCHost } from '@/hooks/useWebRTCHost';
import { useWebRTCViewer } from '@/hooks/useWebRTCViewer';
import { useScreenShare } from '@/hooks/useScreenShare';
import { useChat } from '@/hooks/useChat';
import { sessionApi } from '@/lib/api/sessions';
import { endHostSession } from '@/lib/host-session';
import { VideoViewer } from '@/components/VideoViewer';
import { ChatPanel } from '@/components/ChatPanel';
import { SessionInfo } from '@/components/SessionInfo';
import { ConnectionBadge } from '@/components/ConnectionBadge';

export default function SessionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id: string;
    role: string;
    participantId: string;
  }>();
  const { user } = useAuth();

  const sessionId = (params.id as string | undefined) ?? '';
  const role = (params.role as string | undefined) ?? 'viewer';
  const participantId = (params.participantId as string | undefined) ?? user?.id ?? '';

  const [joinCode, setJoinCode] = useState('');
  const [loadingSession, setLoadingSession] = useState(true);

  // Fetch session details
  useEffect(() => {
    async function fetchSession() {
      const result = await sessionApi.get(sessionId);
      if (result.data) {
        setJoinCode((result.data.join_code as string | undefined) ?? '');
      }
      setLoadingSession(false);
    }
    void fetchSession();
  }, [sessionId]);

  // Chat
  const chat = useChat({
    sessionId,
    participantId,
    enabled: !loadingSession,
  });

  if (role === 'host') {
    return (
      <HostSession
        sessionId={sessionId}
        hostId={user?.id ?? ''}
        joinCode={joinCode}
        chat={chat}
        currentUserId={user?.id}
        router={router}
        loadingSession={loadingSession}
      />
    );
  }

  return (
    <ViewerSession
      sessionId={sessionId}
      participantId={participantId}
      joinCode={joinCode}
      chat={chat}
      currentUserId={user?.id}
      router={router}
      loadingSession={loadingSession}
    />
  );
}

// ── Host Mode ──────────────────────────────────────────────────────

interface HostSessionProps {
  sessionId: string;
  hostId: string;
  joinCode: string;
  chat: ReturnType<typeof useChat>;
  currentUserId?: string;
  router: ReturnType<typeof useRouter>;
  loadingSession: boolean;
}

function HostSession({
  sessionId,
  hostId,
  joinCode,
  chat,
  currentUserId,
  router,
  loadingSession,
}: HostSessionProps) {
  const webrtc = useWebRTCHost({
    sessionId,
    hostId,
  });
  const screenShare = useScreenShare({
    publishStream: webrtc.publishStream,
    unpublishStream: webrtc.unpublishStream,
  });
  const stopScreenShare = screenShare.stop;
  const endingSessionRef = useRef(false);

  // Auto-start hosting when session loads
  useEffect(() => {
    if (!loadingSession && !webrtc.isHosting) {
      void webrtc.startHosting();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSession]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        void stopScreenShare();
      };
    }, [stopScreenShare])
  );

  function handleEndSession() {
    Alert.alert('End Session', 'Are you sure you want to end this session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: () => {
          if (endingSessionRef.current) return;
          endingSessionRef.current = true;
          void (async () => {
            try {
              await endHostSession({
                stopScreenShare: screenShare.stop,
                endSession: () => sessionApi.end(sessionId),
                stopHosting: webrtc.stopHosting,
                goBack: () => {
                  router.back();
                },
              });
            } catch (endError) {
              console.error('[Session] Failed to end session:', endError);
              endingSessionRef.current = false;
              Alert.alert('Unable to end session', 'Please check your connection and try again.');
            }
          })();
        },
      },
    ]);
  }

  return (
    <View className="flex-1 bg-gray-950">
      {/* Session info bar */}
      <SessionInfo
        joinCode={joinCode}
        viewerCount={webrtc.viewerCount}
        isHosting={webrtc.isHosting}
      />

      {/* Error */}
      {webrtc.error && (
        <View className="bg-red-900/50 px-4 py-2">
          <Text className="text-sm text-red-300">{webrtc.error}</Text>
        </View>
      )}
      {screenShare.error && (
        <View className="bg-red-900/50 px-4 py-2">
          <Text className="text-sm text-red-300">{screenShare.error}</Text>
        </View>
      )}

      {/* Main content */}
      <View className="flex-1 items-center justify-center">
        {!webrtc.isHosting ? (
          <ActivityIndicator size="large" color="#3b82f6" />
        ) : screenShare.isBusy ? (
          <View className="items-center gap-4 px-8">
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text className="text-center text-gray-300">
              {screenShare.state === 'requesting'
                ? 'Waiting for screen capture permission...'
                : screenShare.state === 'publishing'
                  ? 'Connecting the screen share to viewers...'
                  : 'Stopping screen sharing...'}
            </Text>
          </View>
        ) : !screenShare.isSharing ? (
          <View className="items-center gap-4 px-8">
            <Text className="text-lg font-semibold text-white">Ready to share</Text>
            {Platform.OS === 'ios' ? (
              <Text className="text-center text-gray-400">
                Full-device sharing on iOS requires ReplayKit and is not available in this build.
              </Text>
            ) : (
              <>
                <Text className="text-center text-gray-400">
                  Tap the button below to start sharing your screen with viewers.
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    void screenShare.start();
                  }}
                  disabled={screenShare.isBusy}
                  className="mt-4 rounded-xl bg-primary-600 px-8 py-4"
                >
                  <Text className="text-lg font-bold text-white">Share Screen</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : (
          <View className="flex-1 items-center justify-center">
            <View className="rounded-full bg-green-900/50 px-4 py-2">
              <Text className="text-sm font-medium text-green-400">Screen sharing active</Text>
            </View>
          </View>
        )}
      </View>

      {/* Controls */}
      <View className="flex-row items-center justify-center gap-4 border-t border-gray-800 px-4 py-3">
        {screenShare.isSharing && (
          <TouchableOpacity
            onPress={() => {
              void screenShare.stop();
            }}
            disabled={screenShare.isBusy}
            className="rounded-lg bg-yellow-600 px-4 py-2"
          >
            <Text className="text-sm font-medium text-white">Stop Sharing</Text>
          </TouchableOpacity>
        )}
        {webrtc.hasMic && (
          <TouchableOpacity
            onPress={webrtc.toggleMic}
            className={`rounded-lg px-4 py-2 ${webrtc.micEnabled ? 'bg-gray-700' : 'bg-red-700'}`}
          >
            <Text className="text-sm font-medium text-white">
              {webrtc.micEnabled ? 'Mute' : 'Unmute'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={handleEndSession} className="rounded-lg bg-red-600 px-4 py-2">
          <Text className="text-sm font-medium text-white">End Session</Text>
        </TouchableOpacity>
      </View>

      {/* Chat */}
      <ChatPanel
        messages={chat.messages}
        onSend={chat.sendMessage}
        sending={chat.sending}
        currentUserId={currentUserId}
        loading={chat.loading}
      />
    </View>
  );
}

// ── Viewer Mode ────────────────────────────────────────────────────

interface ViewerSessionProps {
  sessionId: string;
  participantId: string;
  joinCode: string;
  chat: ReturnType<typeof useChat>;
  currentUserId?: string;
  router: ReturnType<typeof useRouter>;
  loadingSession: boolean;
}

function ViewerSession({
  sessionId,
  participantId,
  joinCode: _joinCode,
  chat,
  currentUserId,
  router,
  loadingSession: _loadingSession,
}: ViewerSessionProps) {
  const leavingSessionRef = useRef(false);
  const webrtc = useWebRTCViewer({
    sessionId,
    participantId,
    onKicked: (reason) => {
      Alert.alert('Removed', reason ?? 'You were removed from the session', [
        {
          text: 'OK',
          onPress: () => {
            router.back();
          },
        },
      ]);
    },
  });

  function handleLeave() {
    Alert.alert('Leave Session', 'Are you sure you want to leave?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          if (leavingSessionRef.current) return;
          leavingSessionRef.current = true;
          webrtc.disconnect();
          router.back();
        },
      },
    ]);
  }

  return (
    <View className="flex-1 bg-black">
      {/* Video */}
      <View className="flex-1">
        <VideoViewer stream={webrtc.remoteStream} />

        {/* Connection badge overlay */}
        <View className="absolute left-4 top-12">
          <ConnectionBadge
            connectionState={webrtc.connectionState}
            networkQuality={webrtc.networkQuality}
          />
        </View>

        {/* Error overlay */}
        {webrtc.error && (
          <View className="absolute left-0 right-0 top-24 items-center">
            <View className="rounded-lg bg-red-900/80 px-4 py-2">
              <Text className="text-sm text-red-200">{webrtc.error}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Controls */}
      <View className="flex-row items-center justify-center gap-4 border-t border-gray-800 bg-gray-900 px-4 py-3">
        {webrtc.connectionState === 'failed' && (
          <TouchableOpacity
            onPress={webrtc.reconnect}
            className="rounded-lg bg-primary-600 px-4 py-2"
          >
            <Text className="text-sm font-medium text-white">Reconnect</Text>
          </TouchableOpacity>
        )}
        {webrtc.hasMic && (
          <TouchableOpacity
            onPress={webrtc.toggleMic}
            className={`rounded-lg px-4 py-2 ${webrtc.micEnabled ? 'bg-gray-700' : 'bg-red-700'}`}
          >
            <Text className="text-sm font-medium text-white">
              {webrtc.micEnabled ? 'Mute' : 'Unmute'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={handleLeave} className="rounded-lg bg-red-600 px-4 py-2">
          <Text className="text-sm font-medium text-white">Leave</Text>
        </TouchableOpacity>
      </View>

      {/* Chat */}
      <ChatPanel
        messages={chat.messages}
        onSend={chat.sendMessage}
        sending={chat.sending}
        currentUserId={currentUserId}
        loading={chat.loading}
      />
    </View>
  );
}
