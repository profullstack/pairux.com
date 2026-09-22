import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Linking, Platform } from 'react-native';
import { MicrophoneNotice } from './MicrophoneNotice';
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  TouchableOpacity: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children?: React.ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
  }) => (
    <button onClick={onPress} aria-label={accessibilityLabel}>
      {children}
    </button>
  ),
  Platform: { OS: 'android' },
  Linking: { openSettings: vi.fn(async () => {}) },
}));
beforeEach(() => {
  Platform.OS = 'android';
});
it('does not open settings automatically and shows requests without enabling a mic', () => {
  const { rerender } = render(<MicrophoneNotice failure={null} />);
  expect(screen.queryByText(/microphone/i)).toBeNull();
  rerender(<MicrophoneNotice failure={null} unmuteRequested />);
  expect(screen.getByText(/still muted/)).toBeDefined();
  expect(Linking.openSettings).not.toHaveBeenCalled();
});
it.each(['android', 'ios'] as const)(
  'shows safe listen-only feedback and settings action on %s',
  async (os) => {
    Platform.OS = os;
    render(<MicrophoneNotice failure="permission" />);
    expect(screen.getByText(/Listen-only/)).toBeDefined();
    expect(Linking.openSettings).not.toHaveBeenCalled();
    vi.mocked(Linking.openSettings).mockRejectedValueOnce(new Error('PRIVATE_ERROR'));
    fireEvent.click(screen.getByRole('button', { name: 'Open microphone settings' }));
    await waitFor(() => expect(screen.getByText('Could not open Settings.')).toBeDefined());
    expect(screen.queryByText('PRIVATE_ERROR')).toBeNull();
  }
);
it('does not label an unknown mic failure as denied permission', () => {
  render(<MicrophoneNotice failure="unavailable" />);
  expect(screen.getByText('Microphone unavailable. Listen-only mode.')).toBeDefined();
  expect(screen.queryByRole('button')).toBeNull();
});
it('does not offer native Settings on web', () => {
  Platform.OS = 'web';
  render(<MicrophoneNotice failure="permission" />);
  expect(screen.getByText(/Listen-only/)).toBeDefined();
  expect(screen.queryByRole('button')).toBeNull();
  expect(Linking.openSettings).not.toHaveBeenCalled();
});
it('clears Settings feedback when microphone state changes and ignores late failures', async () => {
  let reject!: (reason: unknown) => void;
  vi.mocked(Linking.openSettings).mockReturnValueOnce(
    new Promise<void>((_, fail) => {
      reject = fail;
    })
  );
  const { rerender } = render(<MicrophoneNotice failure="permission" />);
  fireEvent.click(screen.getByRole('button', { name: 'Open microphone settings' }));
  rerender(<MicrophoneNotice failure={null} unmuteRequested />);
  await act(async () => {
    reject(new Error('late'));
  });
  expect(screen.queryByText('Could not open Settings.')).toBeNull();
  rerender(<MicrophoneNotice failure="permission" />);
  expect(screen.queryByText('Could not open Settings.')).toBeNull();
  vi.mocked(Linking.openSettings).mockRejectedValueOnce(new Error('current'));
  fireEvent.click(screen.getByRole('button', { name: 'Open microphone settings' }));
  await waitFor(() => expect(screen.getByText('Could not open Settings.')).toBeDefined());
  rerender(<MicrophoneNotice failure="unavailable" />);
  expect(screen.queryByText('Could not open Settings.')).toBeNull();
});
