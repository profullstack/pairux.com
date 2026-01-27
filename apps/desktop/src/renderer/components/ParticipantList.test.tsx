import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ParticipantList } from './ParticipantList';
import type { SessionParticipant } from '@pairux/shared-types';

const createMockParticipant = (
  overrides: Partial<SessionParticipant> = {}
): SessionParticipant => ({
  id: 'participant-1',
  session_id: 'session-1',
  user_id: 'user-1',
  display_name: 'Test User',
  role: 'viewer',
  control_state: 'view-only',
  is_backup_host: false,
  connection_status: 'connected',
  last_seen_at: new Date().toISOString(),
  joined_at: new Date().toISOString(),
  left_at: null,
  ...overrides,
});

describe('ParticipantList', () => {
  it('renders empty state when no participants', () => {
    render(<ParticipantList participants={[]} />);

    expect(screen.getByText('No participants yet')).toBeInTheDocument();
    expect(screen.getByText('Share your link to invite others')).toBeInTheDocument();
  });

  it('renders participant count', () => {
    const participants = [
      createMockParticipant({ id: 'p-1', display_name: 'User 1' }),
      createMockParticipant({ id: 'p-2', display_name: 'User 2' }),
    ];

    render(<ParticipantList participants={participants} />);

    expect(screen.getByText('2 active')).toBeInTheDocument();
  });

  it('renders participant names', () => {
    const participants = [
      createMockParticipant({ id: 'p-1', display_name: 'Alice' }),
      createMockParticipant({ id: 'p-2', display_name: 'Bob' }),
    ];

    render(<ParticipantList participants={participants} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows host badge for host role', () => {
    const participants = [
      createMockParticipant({ id: 'p-1', display_name: 'Host User', role: 'host' }),
    ];

    render(<ParticipantList participants={participants} />);

    expect(screen.getByText('Host')).toBeInTheDocument();
  });

  it('shows viewer badge for viewer role', () => {
    const participants = [
      createMockParticipant({ id: 'p-1', display_name: 'Viewer User', role: 'viewer' }),
    ];

    render(<ParticipantList participants={participants} />);

    expect(screen.getByText('Viewer')).toBeInTheDocument();
  });

  it('shows in control badge when control is granted', () => {
    const participants = [
      createMockParticipant({
        id: 'p-1',
        display_name: 'Controller',
        role: 'viewer',
        control_state: 'granted',
      }),
    ];

    render(<ParticipantList participants={participants} />);

    expect(screen.getByText('In Control')).toBeInTheDocument();
  });

  it('shows requesting badge when control is requested', () => {
    const participants = [
      createMockParticipant({
        id: 'p-1',
        display_name: 'Requester',
        role: 'viewer',
        control_state: 'requested',
      }),
    ];

    render(<ParticipantList participants={participants} />);

    expect(screen.getByText('Requesting')).toBeInTheDocument();
  });

  it('shows (you) indicator for current user', () => {
    const participants = [
      createMockParticipant({ id: 'p-1', user_id: 'current-user', display_name: 'Me' }),
    ];

    render(<ParticipantList participants={participants} currentUserId="current-user" />);

    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('filters out participants who have left', () => {
    const participants = [
      createMockParticipant({ id: 'p-1', display_name: 'Active User', left_at: null }),
      createMockParticipant({
        id: 'p-2',
        display_name: 'Left User',
        left_at: new Date().toISOString(),
      }),
    ];

    render(<ParticipantList participants={participants} />);

    expect(screen.getByText('Active User')).toBeInTheDocument();
    expect(screen.queryByText('Left User')).not.toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();
  });

  it('shows connection status', () => {
    const participants = [
      createMockParticipant({
        id: 'p-1',
        display_name: 'Connected User',
        connection_status: 'connected',
      }),
    ];

    render(<ParticipantList participants={participants} />);

    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('shows reconnecting status', () => {
    const participants = [
      createMockParticipant({
        id: 'p-1',
        display_name: 'Reconnecting User',
        connection_status: 'reconnecting',
      }),
    ];

    render(<ParticipantList participants={participants} />);

    expect(screen.getByText('reconnecting')).toBeInTheDocument();
  });

  describe('Host Actions', () => {
    it('shows grant control button for viewers when isHost is true', () => {
      const participants = [
        createMockParticipant({
          id: 'p-1',
          display_name: 'Viewer',
          role: 'viewer',
          control_state: 'view-only',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
        />
      );

      expect(screen.getByTitle('Grant control')).toBeInTheDocument();
    });

    it('shows revoke control button when viewer has control', () => {
      const participants = [
        createMockParticipant({
          id: 'p-1',
          display_name: 'Controller',
          role: 'viewer',
          control_state: 'granted',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
        />
      );

      expect(screen.getByTitle('Revoke control')).toBeInTheDocument();
    });

    it('shows kick button for viewers when isHost is true', () => {
      const participants = [
        createMockParticipant({
          id: 'p-1',
          display_name: 'Viewer',
          role: 'viewer',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
        />
      );

      expect(screen.getByTitle('Remove participant')).toBeInTheDocument();
    });

    it('does not show actions for host participant', () => {
      const participants = [
        createMockParticipant({
          id: 'p-1',
          display_name: 'Host',
          role: 'host',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
        />
      );

      expect(screen.queryByTitle('Grant control')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Remove participant')).not.toBeInTheDocument();
    });

    it('does not show actions when isHost is false', () => {
      const participants = [
        createMockParticipant({
          id: 'p-1',
          display_name: 'Viewer',
          role: 'viewer',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={false}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
        />
      );

      expect(screen.queryByTitle('Grant control')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Remove participant')).not.toBeInTheDocument();
    });

    it('calls onGrantControl when grant button is clicked', async () => {
      const onGrantControl = vi.fn().mockResolvedValue(undefined);
      const participants = [
        createMockParticipant({
          id: 'p-1',
          display_name: 'Viewer',
          role: 'viewer',
          control_state: 'view-only',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={onGrantControl}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTitle('Grant control'));

      await waitFor(() => {
        expect(onGrantControl).toHaveBeenCalledWith('p-1');
      });
    });

    it('calls onRevokeControl when revoke button is clicked', async () => {
      const onRevokeControl = vi.fn().mockResolvedValue(undefined);
      const participants = [
        createMockParticipant({
          id: 'p-1',
          display_name: 'Controller',
          role: 'viewer',
          control_state: 'granted',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={onRevokeControl}
          onKickParticipant={vi.fn()}
        />
      );

      fireEvent.click(screen.getByTitle('Revoke control'));

      await waitFor(() => {
        expect(onRevokeControl).toHaveBeenCalledWith('p-1');
      });
    });

    it('calls onKickParticipant when kick button is clicked', async () => {
      const onKickParticipant = vi.fn().mockResolvedValue(undefined);
      const participants = [
        createMockParticipant({
          id: 'p-1',
          display_name: 'Viewer',
          role: 'viewer',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={onKickParticipant}
        />
      );

      fireEvent.click(screen.getByTitle('Remove participant'));

      await waitFor(() => {
        expect(onKickParticipant).toHaveBeenCalledWith('p-1');
      });
    });
  });

  describe('Mute Actions', () => {
    it('shows mute button when onMuteParticipant is provided and isHost', () => {
      const participants = [
        createMockParticipant({
          id: 'p-1',
          user_id: 'user-1',
          display_name: 'Viewer',
          role: 'viewer',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
          onMuteParticipant={vi.fn()}
          mutedParticipants={new Set<string>()}
        />
      );

      expect(screen.getByTitle('Mute participant')).toBeInTheDocument();
    });

    it('does not show mute button when onMuteParticipant is not provided', () => {
      const participants = [
        createMockParticipant({
          id: 'p-1',
          user_id: 'user-1',
          display_name: 'Viewer',
          role: 'viewer',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
        />
      );

      expect(screen.queryByTitle('Mute participant')).not.toBeInTheDocument();
    });

    it('shows unmute button for muted participants', () => {
      const participants = [
        createMockParticipant({
          id: 'p-1',
          user_id: 'user-1',
          display_name: 'Viewer',
          role: 'viewer',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
          onMuteParticipant={vi.fn()}
          mutedParticipants={new Set<string>(['user-1'])}
        />
      );

      expect(screen.getByTitle('Unmute participant')).toBeInTheDocument();
    });

    it('calls onMuteParticipant with user_id and true when muting', () => {
      const onMuteParticipant = vi.fn();
      const participants = [
        createMockParticipant({
          id: 'p-1',
          user_id: 'user-1',
          display_name: 'Viewer',
          role: 'viewer',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
          onMuteParticipant={onMuteParticipant}
          mutedParticipants={new Set<string>()}
        />
      );

      fireEvent.click(screen.getByTitle('Mute participant'));
      expect(onMuteParticipant).toHaveBeenCalledWith('user-1', true);
    });

    it('calls onMuteParticipant with user_id and false when unmuting', () => {
      const onMuteParticipant = vi.fn();
      const participants = [
        createMockParticipant({
          id: 'p-1',
          user_id: 'user-1',
          display_name: 'Viewer',
          role: 'viewer',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
          onMuteParticipant={onMuteParticipant}
          mutedParticipants={new Set<string>(['user-1'])}
        />
      );

      fireEvent.click(screen.getByTitle('Unmute participant'));
      expect(onMuteParticipant).toHaveBeenCalledWith('user-1', false);
    });

    it('does not show mute button for host participant', () => {
      const participants = [
        createMockParticipant({
          id: 'p-1',
          user_id: 'user-1',
          display_name: 'Host',
          role: 'host',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
          onMuteParticipant={vi.fn()}
          mutedParticipants={new Set<string>()}
        />
      );

      expect(screen.queryByTitle('Mute participant')).not.toBeInTheDocument();
    });

    it('does not show mute button for participant with null user_id', () => {
      const participants = [
        createMockParticipant({
          id: 'p-1',
          user_id: null,
          display_name: 'Anonymous',
          role: 'viewer',
        }),
      ];

      render(
        <ParticipantList
          participants={participants}
          isHost={true}
          onGrantControl={vi.fn()}
          onRevokeControl={vi.fn()}
          onKickParticipant={vi.fn()}
          onMuteParticipant={vi.fn()}
          mutedParticipants={new Set<string>()}
        />
      );

      expect(screen.queryByTitle('Mute participant')).not.toBeInTheDocument();
    });
  });
});
