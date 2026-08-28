import { vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as React from 'react';

// Make React available globally for JSX
globalThis.React = React;

const appStateMock = vi.hoisted(() => ({
  currentState: 'active',
  listeners: new Set<(state: string) => void>(),
}));

export function emitAppStateChange(state: 'active' | 'background' | 'inactive'): void {
  appStateMock.currentState = state;
  for (const listener of appStateMock.listeners) {
    listener(state);
  }
}

// Suppress console noise in tests
const originalConsole = { ...console };
beforeEach(() => {
  appStateMock.currentState = 'active';
  mockPeerConnections.length = 0;
  vi.stubGlobal('console', {
    ...originalConsole,
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
  });
  global.fetch = vi.fn();
});

afterEach(() => {
  cleanup();
  appStateMock.listeners.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── Mock: expo-constants ──────────────────────────────────────────
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

// ── Mock: expo-secure-store ───────────────────────────────────────
const secureStoreData = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStoreData.set(key, value);
  }),
  getItemAsync: vi.fn(async (key: string) => {
    return secureStoreData.get(key) ?? null;
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStoreData.delete(key);
  }),
}));

// Expose for test manipulation
export { secureStoreData };

// ── Mock: react-native ────────────────────────────────────────────
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  FlatList: 'FlatList',
  Alert: { alert: vi.fn() },
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
  AppState: {
    get currentState() {
      return appStateMock.currentState;
    },
    addEventListener: vi.fn((_event: string, listener: (state: string) => void) => {
      appStateMock.listeners.add(listener);
      return {
        remove: vi.fn(() => {
          appStateMock.listeners.delete(listener);
        }),
      };
    }),
  },
  Animated: {
    View: 'Animated.View',
    Value: vi.fn(() => ({
      setValue: vi.fn(),
    })),
    timing: vi.fn(() => ({ start: vi.fn() })),
  },
}));

// ── Mock: react-native-webrtc ─────────────────────────────────────
const mockPeerConnections: MockRTCPeerConnection[] = [];

class MockRTCPeerConnection {
  signalingState = 'stable';
  connectionState = 'new';
  iceConnectionState = 'new';
  localDescription: unknown = null;
  remoteDescription: unknown = null;
  _pcId = 1;
  _transceivers: unknown[] = [];
  _remoteStreams = new Map();
  _pendingTrackEvents: unknown[] = [];
  _senders: {
    track: { kind: string } | null;
    getParameters: () => { encodings: Record<string, unknown>[] };
    setParameters: ReturnType<typeof vi.fn>;
  }[] = [];

  constructor() {
    mockPeerConnections.push(this);
  }

  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-sdp' });
  createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' });
  setLocalDescription = vi.fn(async (desc: unknown) => {
    this.localDescription = desc;
  });
  setRemoteDescription = vi.fn(async (desc: unknown) => {
    this.remoteDescription = desc;
  });
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  addTrack = vi.fn((track: { kind: string }) => {
    const sender = {
      getParameters: () => ({ encodings: [{}] }),
      setParameters: vi.fn().mockResolvedValue(undefined),
      track,
    };
    this._senders.push(sender);
    return sender;
  });
  removeTrack = vi.fn((sender: (typeof this._senders)[number]) => {
    this._senders = this._senders.filter((candidate) => candidate !== sender);
  });
  getSenders = vi.fn(() => [...this._senders]);
  getReceivers = vi.fn().mockReturnValue([]);
  getTransceivers = vi.fn().mockReturnValue([]);
  getStats = vi.fn().mockResolvedValue(new Map());
  createDataChannel = vi.fn().mockReturnValue({
    readyState: 'open',
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    label: 'control',
    id: 0,
    ordered: true,
    protocol: '',
    negotiated: false,
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
  });
  close = vi.fn();
  restartIce = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  setConfiguration = vi.fn();
  _registerEvents = vi.fn();
}

vi.mock('react-native-webrtc', () => ({
  RTCPeerConnection: MockRTCPeerConnection,
  RTCIceCandidate: vi.fn((init: unknown) => init),
  RTCSessionDescription: vi.fn((init: unknown) => init),
  MediaStream: vi.fn(() => ({
    getTracks: vi.fn().mockReturnValue([]),
    getAudioTracks: vi.fn().mockReturnValue([]),
    getVideoTracks: vi.fn().mockReturnValue([]),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
  })),
  MediaStreamTrack: vi.fn(),
  mediaDevices: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: vi.fn().mockReturnValue([]),
      getAudioTracks: vi.fn().mockReturnValue([{ kind: 'audio', enabled: true, stop: vi.fn() }]),
      getVideoTracks: vi.fn().mockReturnValue([]),
    }),
    getDisplayMedia: vi.fn().mockResolvedValue({
      getTracks: vi.fn().mockReturnValue([{ kind: 'video', enabled: true, stop: vi.fn() }]),
      getAudioTracks: vi.fn().mockReturnValue([]),
      getVideoTracks: vi.fn().mockReturnValue([{ kind: 'video', enabled: true, stop: vi.fn() }]),
    }),
  },
  RTCView: 'RTCView',
}));

// Export for test use
export { MockRTCPeerConnection, mockPeerConnections };

// ── Mock: react-native-sse ────────────────────────────────────────
vi.mock('react-native-sse', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
    })),
  };
});

// ── Mock: expo-router ─────────────────────────────────────────────
vi.mock('expo-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    navigate: vi.fn(),
  }),
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  Redirect: 'Redirect',
  Stack: { Screen: 'Stack.Screen' },
  Tabs: { Screen: 'Tabs.Screen' },
  Link: 'Link',
}));

// ── Mock: expo-clipboard ──────────────────────────────────────────
vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn().mockResolvedValue(true),
}));

// ── Mock: expo-splash-screen ──────────────────────────────────────
vi.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: vi.fn(),
  hideAsync: vi.fn(),
}));

// ── Mock: expo-font ───────────────────────────────────────────────
vi.mock('expo-font', () => ({
  useFonts: vi.fn().mockReturnValue([true, null]),
  isLoaded: vi.fn().mockReturnValue(true),
}));

// ── Mock: @expo-google-fonts ──────────────────────────────────────
vi.mock('@expo-google-fonts/inter', () => ({
  useFonts: vi.fn().mockReturnValue([true, null]),
  Inter_400Regular: 'Inter_400Regular',
  Inter_500Medium: 'Inter_500Medium',
  Inter_600SemiBold: 'Inter_600SemiBold',
  Inter_700Bold: 'Inter_700Bold',
}));

vi.mock('@expo-google-fonts/jetbrains-mono', () => ({
  useFonts: vi.fn().mockReturnValue([true, null]),
  JetBrainsMono_400Regular: 'JetBrainsMono_400Regular',
}));
