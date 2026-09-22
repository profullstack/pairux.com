import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import SessionScreen from '../../app/(app)/session/[id]';

const state = vi.hoisted(() => ({
  role: 'viewer',
  viewer: {
    micFailure: null as 'permission' | 'unavailable' | null,
    unmuteRequested: true,
    hasMic: true,
    micEnabled: false,
    connectionState: 'connected',
    toggleMic: vi.fn(),
    disconnect: vi.fn(),
  },
  host: {
    micFailure: 'permission' as const,
    hasMic: false,
    micEnabled: false,
    isHosting: true,
    viewerCount: 0,
    toggleMic: vi.fn(),
    startHosting: vi.fn(),
  },
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  TouchableOpacity: ({
    children,
    onPress,
    accessibilityLabel,
    disabled,
  }: {
    children?: React.ReactNode;
    onPress: () => void;
    accessibilityLabel?: string;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} aria-label={accessibilityLabel} disabled={disabled}>
      {children}
    </button>
  ),
  ActivityIndicator: () => <span>Loading</span>,
  Alert: { alert: vi.fn() },
  Platform: { OS: 'android' },
  Linking: { openSettings: vi.fn(async () => {}) },
}));
vi.mock('expo-router', () => ({
  useRouter: () => ({ back: vi.fn() }),
  useFocusEffect: vi.fn(),
  useLocalSearchParams: () => ({ id: 'session-1', role: state.role, participantId: 'viewer-1' }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/hooks/useWebRTCViewer', () => ({ useWebRTCViewer: () => state.viewer }));
vi.mock('@/hooks/useWebRTCHost', () => ({ useWebRTCHost: () => state.host }));
vi.mock('@/hooks/useScreenShare', () => ({ useScreenShare: () => ({ stop: vi.fn() }) }));
vi.mock('@/hooks/useChat', () => ({ useChat: () => ({ messages: [] }) }));
vi.mock('@/lib/api/sessions', () => ({
  sessionApi: { get: vi.fn(async () => ({ data: { join_code: 'ABC' } })) },
}));
vi.mock('@/components/VideoViewer', () => ({ VideoViewer: () => null }));
vi.mock('@/components/ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('@/components/SessionInfo', () => ({ SessionInfo: () => null }));
vi.mock('@/components/ConnectionBadge', () => ({ ConnectionBadge: () => null }));
beforeEach(() => {
  state.role = 'viewer';
  state.viewer.hasMic = true;
  state.viewer.micFailure = null;
});
it('wires a viewer unmute request to feedback but only the local button to toggleMic', async () => {
  render(<SessionScreen />);
  await waitFor(() => expect(screen.getByText(/still muted/)).toBeDefined());
  expect(state.viewer.toggleMic).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
  expect(state.viewer.toggleMic).toHaveBeenCalledOnce();
});
it('keeps leave available and hides unmute when the viewer has no microphone', async () => {
  state.viewer.hasMic = false;
  state.viewer.micFailure = 'unavailable';
  render(<SessionScreen />);
  await waitFor(() =>
    expect(screen.getByText('Microphone unavailable. Listen-only mode.')).toBeDefined()
  );
  expect(screen.queryByRole('button', { name: 'Unmute' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Leave' })).toBeDefined();
});
it('shows host permission feedback and keeps ending the session available', async () => {
  state.role = 'host';
  render(<SessionScreen />);
  await waitFor(() => expect(screen.getByText(/Microphone permission denied/)).toBeDefined());
  expect(screen.getByRole('button', { name: 'Open microphone settings' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'End Session' })).toBeDefined();
  expect(state.host.toggleMic).not.toHaveBeenCalled();
});
