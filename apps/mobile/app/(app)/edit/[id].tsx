/**
 * Recording editor — trim a cloud recording to the parts worth keeping, add
 * fades and an intro/outro, and render it on the server. Rendering creates a
 * new recording; the original is never changed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ResizeMode, Video, type AVPlaybackStatus, type VideoProps } from 'expo-av';
import type { ComponentType, RefAttributes } from 'react';
import { formatTime } from '@pairux/video-edit';
import { recordingsApi, type Recording } from '@/lib/api/recordings';
import {
  MAX_FADE,
  buildPlan,
  clampFade,
  cutSelection,
  desktopEditLink,
  initialEditorState,
  keepSelection,
  outputDuration,
  pct,
  positionToTime,
  rangeGeometry,
  removeRange,
  selectionRange,
  type BumperChoice,
  type EditorState,
  type Selection,
} from '@/lib/recording-editor';

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <View className="flex-1 flex-row items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
      <Text className="text-sm text-gray-700">{label}</Text>
      <View className="flex-row items-center gap-2">
        <TouchableOpacity
          accessibilityLabel={`Decrease ${label}`}
          onPress={() => {
            onChange(clampFade(value - 0.5));
          }}
          className="h-7 w-7 items-center justify-center rounded bg-gray-100"
        >
          <Text className="font-bold text-gray-700">−</Text>
        </TouchableOpacity>
        <Text className="w-10 text-center text-sm font-medium text-gray-900">
          {value.toFixed(1)}s
        </Text>
        <TouchableOpacity
          accessibilityLabel={`Increase ${label}`}
          onPress={() => {
            onChange(clampFade(value + 0.5));
          }}
          disabled={value >= MAX_FADE}
          className="h-7 w-7 items-center justify-center rounded bg-gray-100"
        >
          <Text className="font-bold text-gray-700">+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function BumperEditor({
  label,
  value,
  onChange,
  others,
}: {
  label: string;
  value: BumperChoice;
  onChange: (v: BumperChoice) => void;
  others: Recording[];
}) {
  const kinds: { kind: BumperChoice['kind']; text: string }[] = [
    { kind: 'none', text: 'None' },
    { kind: 'title', text: 'Title card' },
    { kind: 'recording', text: 'Recording' },
  ];
  return (
    <View className="mb-4 rounded-xl border border-gray-200 bg-white p-3">
      <Text className="mb-2 text-sm font-semibold text-gray-700">{label}</Text>
      <View className="mb-2 flex-row gap-2">
        {kinds.map((k) => (
          <TouchableOpacity
            key={k.kind}
            onPress={() => {
              if (k.kind === 'none') onChange({ kind: 'none' });
              else if (k.kind === 'title')
                onChange({ kind: 'title', text: '', subtitle: '', duration: 3 });
              else if (others[0]) onChange({ kind: 'recording', recordingId: others[0].id });
              else Alert.alert('No other recordings', 'Record or upload a clip first.');
            }}
            className={`rounded-full px-3 py-1.5 ${value.kind === k.kind ? 'bg-primary-600' : 'bg-gray-100'}`}
          >
            <Text
              className={`text-xs font-medium ${value.kind === k.kind ? 'text-white' : 'text-gray-700'}`}
            >
              {k.text}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {value.kind === 'title' && (
        <View className="gap-2">
          <TextInput
            value={value.text}
            onChangeText={(text) => {
              onChange({ ...value, text });
            }}
            placeholder="Title"
            maxLength={120}
            className="rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
          />
          <TextInput
            value={value.subtitle}
            onChangeText={(subtitle) => {
              onChange({ ...value, subtitle });
            }}
            placeholder="Subtitle (optional)"
            maxLength={120}
            className="rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
          />
          <View className="flex-row items-center gap-2">
            <Text className="text-sm text-gray-600">Duration</Text>
            {[2, 3, 5].map((d) => (
              <TouchableOpacity
                key={d}
                onPress={() => {
                  onChange({ ...value, duration: d });
                }}
                className={`rounded px-3 py-1 ${value.duration === d ? 'bg-primary-100' : 'bg-gray-100'}`}
              >
                <Text className="text-xs text-gray-800">{d}s</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
      {value.kind === 'recording' && (
        <View className="gap-1">
          {others.map((r) => (
            <TouchableOpacity
              key={r.id}
              onPress={() => {
                onChange({ kind: 'recording', recordingId: r.id });
              }}
              className={`rounded-lg px-3 py-2 ${value.recordingId === r.id ? 'bg-primary-50' : ''}`}
            >
              <Text className="text-sm text-gray-800" numberOfLines={1}>
                {value.recordingId === r.id ? '● ' : '○ '}
                {r.subject?.trim() ? r.subject.trim() : 'Recording'}
                {r.duration_seconds ? ` · ${formatTime(r.duration_seconds, 0)}` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// expo-av's class component is typed against a different @types/react than the app's.
const VideoView = Video as unknown as ComponentType<VideoProps & RefAttributes<Video>>;

export default function EditRecordingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const video = useRef<Video>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [others, setOthers] = useState<Recording[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [selection, setSelection] = useState<Selection>({ in: null, out: null });
  const [state, setState] = useState<EditorState>(initialEditorState);
  const [subject, setSubject] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    void recordingsApi.get(id).then((r) => {
      if (r.data) {
        setRecording(r.data.recording);
        setSubject(r.data.recording.subject ? `${r.data.recording.subject} (edit)` : '');
        if (r.data.recording.duration_seconds) setDuration(r.data.recording.duration_seconds);
      } else setLoadError(r.error ?? 'Could not load the recording');
    });
    void recordingsApi.list().then((r) => {
      if (r.data) setOthers(r.data.recordings.filter((x) => x.id !== id && x.status === 'ready'));
    });
  }, [id]);

  const onStatus = useCallback((s: AVPlaybackStatus) => {
    if (!s.isLoaded) return;
    setPosition(s.positionMillis / 1000);
    if (s.durationMillis && s.durationMillis > 0) setDuration(s.durationMillis / 1000);
  }, []);

  const seek = useCallback(
    (e: GestureResponderEvent) => {
      if (!duration) return;
      const t = positionToTime(e.nativeEvent.locationX, trackWidth, duration);
      setPosition(t);
      void video.current?.setPositionAsync(t * 1000, {
        toleranceMillisBefore: 100,
        toleranceMillisAfter: 100,
      });
    },
    [duration, trackWidth]
  );

  async function render() {
    if (!recording) return;
    let plan;
    try {
      plan = buildPlan(state, duration);
    } catch (error) {
      Alert.alert('Check the edit', error instanceof Error ? error.message : String(error));
      return;
    }
    setSubmitting(true);
    const result = await recordingsApi.edit(recording.id, plan, subject.trim() || undefined);
    setSubmitting(false);
    if (result.error) {
      Alert.alert('Could not start the render', result.error);
      return;
    }
    router.replace('/(app)/recordings');
  }

  async function openInDesktop() {
    if (!recording?.playback_url) return;
    const link = desktopEditLink(recording.playback_url, recording.subject);
    try {
      await Linking.openURL(link);
    } catch {
      Alert.alert(
        'PairUX desktop needed',
        'Private, end-to-end encrypted publishing to c0mpute runs in the PairUX desktop app, which encrypts the file on your computer. Install it from pairux.com/download, then try again.'
      );
    }
  }

  if (loadError) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50 px-6">
        <Text className="text-center text-red-600">{loadError}</Text>
      </View>
    );
  }
  if (!recording) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  const sel = selectionRange(selection);
  const playheadLeft = duration ? Math.min(1, position / duration) : 0;

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-4 pb-12">
      {recording.playback_url ? (
        <VideoView
          ref={video}
          source={{ uri: recording.playback_url }}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          progressUpdateIntervalMillis={250}
          onPlaybackStatusUpdate={onStatus}
          style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 12 }}
        />
      ) : (
        <Text className="text-gray-500">This recording has no playable file.</Text>
      )}

      {/* Timeline */}
      <View className="mt-4">
        <View className="mb-1 flex-row justify-between">
          <Text className="text-xs text-gray-500">{formatTime(position)}</Text>
          <Text className="text-xs text-gray-500">
            {duration ? formatTime(duration, 0) : '--:--'}
          </Text>
        </View>
        <View
          className="h-12 overflow-hidden rounded-lg bg-gray-200"
          onLayout={(e) => {
            setTrackWidth(e.nativeEvent.layout.width);
          }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={seek}
          onResponderMove={seek}
          accessibilityLabel="Timeline. Drag to scrub."
        >
          {duration
            ? state.keep.map((r, i) => {
                const g = rangeGeometry(r, duration);
                return (
                  <View
                    key={`k${String(i)}`}
                    className="absolute bottom-0 top-0 bg-primary-500/70"
                    style={{ left: pct(g.left), width: pct(g.width) }}
                  />
                );
              })
            : null}
          {duration && sel ? (
            <View
              className="absolute bottom-0 top-0 border-x-2 border-amber-500 bg-amber-300/40"
              style={{
                left: pct(rangeGeometry(sel, duration).left),
                width: pct(rangeGeometry(sel, duration).width),
              }}
            />
          ) : null}
          <View
            className="absolute bottom-0 top-0 w-0.5 bg-gray-900"
            style={{ left: pct(playheadLeft) }}
          />
        </View>
        <Text className="mt-1 text-xs text-gray-400">
          Blue is kept. Nothing kept means the whole recording.
        </Text>
      </View>

      {/* Selection controls */}
      <View className="mt-3 flex-row flex-wrap gap-2">
        <TouchableOpacity
          onPress={() => {
            setSelection((s) => ({ ...s, in: position }));
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2"
        >
          <Text className="text-sm text-gray-800">
            Set in{selection.in !== null ? ` (${formatTime(selection.in)})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setSelection((s) => ({ ...s, out: position }));
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2"
        >
          <Text className="text-sm text-gray-800">
            Set out{selection.out !== null ? ` (${formatTime(selection.out)})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!sel}
          onPress={() => {
            setState((s) => ({ ...s, keep: keepSelection(s.keep, selection) }));
            setSelection({ in: null, out: null });
          }}
          className={`rounded-lg px-3 py-2 ${sel ? 'bg-primary-600' : 'bg-gray-300'}`}
        >
          <Text className="text-sm font-medium text-white">Keep selection</Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!sel}
          onPress={() => {
            setState((s) => ({ ...s, keep: cutSelection(s.keep, selection, duration) }));
            setSelection({ in: null, out: null });
          }}
          className={`rounded-lg px-3 py-2 ${sel ? 'bg-red-600' : 'bg-gray-300'}`}
        >
          <Text className="text-sm font-medium text-white">Cut selection</Text>
        </TouchableOpacity>
      </View>

      {/* Kept ranges */}
      {state.keep.length > 0 && (
        <View className="mt-4 rounded-xl border border-gray-200 bg-white p-3">
          <Text className="mb-2 text-sm font-semibold text-gray-700">Kept</Text>
          {state.keep.map((r, i) => (
            <View key={`r${String(i)}`} className="flex-row items-center justify-between py-1">
              <TouchableOpacity
                onPress={() => {
                  void video.current?.setPositionAsync(r.start * 1000);
                }}
              >
                <Text className="text-sm text-gray-800">
                  {formatTime(r.start)} – {formatTime(r.end)} ({formatTime(r.end - r.start, 0)})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel="Remove range"
                onPress={() => {
                  setState((s) => ({ ...s, keep: removeRange(s.keep, i) }));
                }}
              >
                <Text className="px-2 text-sm text-red-600">Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Fades */}
      <View className="mt-4 flex-row gap-2">
        <Stepper
          label="Fade in"
          value={state.fadeIn}
          onChange={(v) => {
            setState((s) => ({ ...s, fadeIn: v }));
          }}
        />
        <Stepper
          label="Fade out"
          value={state.fadeOut}
          onChange={(v) => {
            setState((s) => ({ ...s, fadeOut: v }));
          }}
        />
      </View>

      <View className="mt-4">
        <BumperEditor
          label="Intro"
          value={state.intro}
          others={others}
          onChange={(intro) => {
            setState((s) => ({ ...s, intro }));
          }}
        />
        <BumperEditor
          label="Outro"
          value={state.outro}
          others={others}
          onChange={(outro) => {
            setState((s) => ({ ...s, outro }));
          }}
        />
      </View>

      <TextInput
        value={subject}
        onChangeText={setSubject}
        placeholder="Title for the edited recording"
        maxLength={200}
        className="mb-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900"
      />

      <TouchableOpacity
        disabled={submitting}
        onPress={() => {
          void render();
        }}
        className="items-center rounded-xl bg-primary-600 py-4"
      >
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="font-semibold text-white">
            Render ({formatTime(outputDuration(state, duration), 0)})
          </Text>
        )}
      </TouchableOpacity>

      {recording.playback_url ? (
        <TouchableOpacity
          onPress={() => {
            void openInDesktop();
          }}
          className="mt-4 rounded-xl border border-gray-200 bg-white p-4"
        >
          <Text className="font-medium text-gray-900">Publish privately to c0mpute</Text>
          <Text className="mt-1 text-xs text-gray-500">
            End-to-end encrypted, keys stay on your computer. Opens in the PairUX desktop app.
          </Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}
