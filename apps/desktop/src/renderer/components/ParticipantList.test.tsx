import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
