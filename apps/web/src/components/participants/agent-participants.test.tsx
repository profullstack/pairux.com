import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SessionParticipant } from '@pairux/shared-types';
import { HostParticipantList } from './HostParticipantList';
import { ParticipantItem } from '@/components/chat/ParticipantItem';

const agent: SessionParticipant = {
  id: 'agent-1',
  session_id: 's1',
  user_id: null,
  display_name: 'Claude Code',
  role: 'viewer',
  control_state: 'view-only',
  is_backup_host: false,
  connection_status: 'connected',
  last_seen_at: null,
  joined_at: '2026-09-24T12:00:00.000Z',
  left_at: null,
  kind: 'agent',
  agent_client: 'claude-code',
};

describe('agent participants on web', () => {
  it('chat roster labels the agent and hides DM', () => {
    render(<ParticipantItem participant={agent} isCurrentUser={false} onStartDM={vi.fn()} />);
    expect(screen.getByTestId('agent-badge')).toHaveTextContent('Agent · claude-code');
    expect(screen.queryByLabelText('Message Claude Code')).not.toBeInTheDocument();
  });

  it('chat roster context menu offers the host only "Remove agent"', () => {
    const onKick = vi.fn();
    render(
      <ParticipantItem
        participant={agent}
        isCurrentUser={false}
        isHostContext
        onGrantControl={vi.fn()}
        onMuteParticipant={vi.fn()}
        onKickParticipant={onKick}
      />
    );
    fireEvent.contextMenu(screen.getByTestId('participant-item'));
    expect(screen.queryByText('Grant control')).not.toBeInTheDocument();
    expect(screen.queryByText('Mute participant')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Remove agent'));
    expect(onKick).toHaveBeenCalledWith(agent);
  });

  it('host sidebar badges the agent and removes it by participant id', () => {
    const onRemoveAgent = vi.fn();
    render(
      <HostParticipantList
        participants={[agent]}
        viewers={new Map()}
        onGrantControl={vi.fn()}
        onRevokeControl={vi.fn()}
        onKickParticipant={vi.fn()}
        onRemoveAgent={onRemoveAgent}
      />
    );
    expect(screen.getByTestId('agent-badge')).toHaveTextContent('Agent');
    expect(screen.queryByTitle('Grant control')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Remove agent'));
    expect(onRemoveAgent).toHaveBeenCalledWith('agent-1');
  });
});
