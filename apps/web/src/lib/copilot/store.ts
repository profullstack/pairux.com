/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import {
  emptyNotes,
  isCopilotMode,
  isCopilotRole,
  type CopilotMode,
  type CopilotRole,
  type CopilotState,
} from '@pairux/meeting-copilot/types';
import { serviceClient } from '@/lib/supabase/service';

/** The whole call is kept; this caps a pathological meeting (about 10 hours). */
export const MAX_STORED_LINES = 6000;

const COLUMNS =
  'id, session_id, user_id, participant_id, role, mode, status, title, notes, suggestions, open_questions, figures, transcript, follow_ups, review, providers, started_at, ended_at';

export interface StoredCopilot {
  state: CopilotState;
  userId: string;
  participantId: string;
  title: string | null;
}

const array = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function rowToStored(row: any): StoredCopilot {
  const notes = row.notes && typeof row.notes === 'object' ? row.notes : {};
  return {
    userId: row.user_id,
    participantId: row.participant_id ?? '',
    title: row.title ?? null,
    state: {
      id: row.id,
      sessionId: row.session_id,
      role: isCopilotRole(row.role) ? row.role : 'general',
      mode: isCopilotMode(row.mode) ? row.mode : 'auto',
      status: row.status === 'ended' ? 'ended' : 'live',
      notes: { ...emptyNotes(), ...notes },
      suggestions: array(row.suggestions),
      openQuestions: array(row.open_questions),
      figures: array(row.figures),
      transcript: array(row.transcript),
      followUps: row.follow_ups ?? null,
      review: row.review ?? null,
      providers: row.providers ?? {},
      notice: '',
      startedAt: row.started_at,
      endedAt: row.ended_at ?? null,
    },
  };
}

export class CopilotStore {
  constructor(private readonly db: any = serviceClient()) {}

  /** Start (or resume) the owner's copilot row for a meeting. */
  async open(input: {
    sessionId: string;
    userId: string;
    participantId: string;
    role: CopilotRole;
    mode: CopilotMode;
    title: string | null;
  }): Promise<StoredCopilot> {
    const { data: existing } = await this.db
      .from('meeting_copilots')
      .select(COLUMNS)
      .eq('session_id', input.sessionId)
      .eq('user_id', input.userId)
      .maybeSingle();
    const now = new Date().toISOString();
    if (existing) {
      const { data, error } = await this.db
        .from('meeting_copilots')
        .update({
          status: 'live',
          role: input.role,
          mode: input.mode,
          participant_id: input.participantId || existing.participant_id,
          ended_at: null,
          updated_at: now,
        })
        .eq('id', existing.id)
        .select(COLUMNS)
        .single();
      if (error) throw new Error(`Resuming the copilot failed: ${String(error.message)}`);
      return rowToStored(data);
    }
    const { data, error } = await this.db
      .from('meeting_copilots')
      .insert({
        session_id: input.sessionId,
        user_id: input.userId,
        participant_id: input.participantId,
        role: input.role,
        mode: input.mode,
        title: input.title,
      })
      .select(COLUMNS)
      .single();
    if (error) throw new Error(`Starting the copilot failed: ${String(error.message)}`);
    return rowToStored(data);
  }

  async save(state: CopilotState): Promise<void> {
    const { error } = await this.db
      .from('meeting_copilots')
      .update({
        role: state.role,
        mode: state.mode,
        status: state.status,
        notes: state.notes,
        suggestions: state.suggestions,
        open_questions: state.openQuestions,
        figures: state.figures,
        transcript: state.transcript.slice(-MAX_STORED_LINES),
        follow_ups: state.followUps,
        review: state.review,
        providers: state.providers,
        ended_at: state.endedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', state.id);
    if (error) console.error('[copilot] save failed:', error);
  }

  async get(id: string, userId: string): Promise<StoredCopilot | null> {
    const { data } = await this.db
      .from('meeting_copilots')
      .select(COLUMNS)
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    return data ? rowToStored(data) : null;
  }

  async list(userId: string, limit = 50) {
    const { data } = await this.db
      .from('meeting_copilots')
      .select('id, session_id, role, mode, status, title, notes, started_at, ended_at')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(limit);
    return ((data ?? []) as any[]).map((row) => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      role: row.role as string,
      mode: row.mode as string,
      status: row.status as string,
      title: (row.title as string | null) ?? null,
      summary: (row.notes?.summary as string | undefined) ?? '',
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string | null) ?? null,
    }));
  }

  /** The owner's copilot in a meeting if the database still says it is live. */
  async findLive(sessionId: string, userId: string): Promise<StoredCopilot | null> {
    const { data } = await this.db
      .from('meeting_copilots')
      .select(COLUMNS)
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .eq('status', 'live')
      .maybeSingle();
    return data ? rowToStored(data) : null;
  }

  /** Copilots left live by a crashed or redeployed process. */
  async live(): Promise<StoredCopilot[]> {
    const { data } = await this.db.from('meeting_copilots').select(COLUMNS).eq('status', 'live');
    return ((data ?? []) as any[]).map(rowToStored);
  }
}
