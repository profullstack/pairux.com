import { describe, expect, it } from 'vitest';
import type { SessionParticipant } from '@pairux/shared-types';
import { liveAgents } from './useSessionAgents';

const base: SessionParticipant = {
  id: 'p',
  session_id: 's',
  user_id: null,
  display_name: 'x',
  role: 'viewer',
  control_state: 'view-only',
  is_backup_host: false,
  connection_status: 'connected',
  last_seen_at: null,
  joined_at: '2026-09-24T12:00:00.000Z',
  left_at: null,
};

describe('liveAgents', () => {
  it('keeps only agents that are still in the session', () => {
    const rows: SessionParticipant[] = [
      // A row read before the migration has no `kind` at all: it is a person.
      { ...base, id: 'human' },
      { ...base, id: 'explicit-human', kind: 'human' },
      { ...base, id: 'agent', kind: 'agent' },
      { ...base, id: 'gone-agent', kind: 'agent', left_at: '2026-09-24T12:05:00.000Z' },
    ];
    expect(liveAgents(rows).map((p) => p.id)).toEqual(['agent']);
  });

  it('treats a session payload without a roster as no agents', () => {
    expect(liveAgents(undefined)).toEqual([]);
    expect(liveAgents(null)).toEqual([]);
  });
});
