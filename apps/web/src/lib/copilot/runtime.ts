/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { LiveVoice } from '@profullstack/live-translate';
import type { CopilotMode, CopilotRole, CopilotState } from '@pairux/meeting-copilot/types';
import { serviceClient } from '@/lib/supabase/service';
import { translationRuntime } from '@/lib/translation/server';
import { CopilotAccounts } from './account';
import { CopilotAgent, writeFollowUps, writeReview } from './agent';
import { CopilotLlm } from './llm';
import { CopilotMeeting, type MeetingParticipant } from './meeting';
import type { ProviderContext } from './providers';
import { CopilotStore, type StoredCopilot } from './store';
import { CopilotVoice } from './voice';

/** Meetings one process runs copilots in at once (CPU-bound free models). */
const MAX_MEETINGS = Number(process.env.COPILOT_MAX_MEETINGS ?? 6);
/** An owner who has not been connected for this long is done. */
const ABANDONED_MS = 120_000;
const SWEEP_MS = 15_000;

export class CopilotBusyError extends Error {}

export class CopilotRuntime {
  readonly accounts = new CopilotAccounts();
  readonly store = new CopilotStore();
  readonly llm = new CopilotLlm(this.accounts);
  private readonly meetings = new Map<string, CopilotMeeting>();
  private readonly contexts = new Map<string, ProviderContext>();
  private readonly starting = new Map<string, Promise<CopilotAgent>>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private ownVoice: LiveVoice | null = null;

  constructor(private readonly db: any = serviceClient()) {}

  /** Our ElevenLabs voice for pay-as-you-go transcription (shared with translation when it runs). */
  private oursVoice(): LiveVoice | null {
    const shared = translationRuntime()?.voice;
    if (shared) return shared;
    if (!process.env.ELEVENLABS_API_KEY) return null;
    this.ownVoice ??= new LiveVoice({
      apiKey: process.env.ELEVENLABS_API_KEY,
      tokenPrefix: 'pxc_',
    });
    return this.ownVoice;
  }

  async context(sessionId: string, userId: string, mode: CopilotMode): Promise<ProviderContext> {
    const [settings, admin] = await Promise.all([
      this.accounts.settingsFor(userId),
      this.accounts.isAdmin(userId),
    ]);
    const ctx: ProviderContext = { userId, sessionId, mode, keys: settings.keys, admin };
    this.contexts.set(`${sessionId}:${userId}`, ctx);
    return ctx;
  }

  /**
   * The copilot room's transcription is billed to its first live owner. A
   * room kept open only for invited agents runs on the free models.
   */
  private payerContext(sessionId: string): ProviderContext {
    const meeting = this.meetings.get(sessionId);
    const payer = meeting?.liveAgents()[0];
    const ctx = payer ? this.contexts.get(`${sessionId}:${payer.userId}`) : undefined;
    if (ctx) return ctx;
    const tap = meeting?.taps.values().next().value;
    return { userId: tap?.payer ?? '', sessionId, mode: 'free', keys: {}, admin: false };
  }

  private meetingFor(sessionId: string, payer: string): CopilotMeeting {
    let meeting = this.meetings.get(sessionId);
    if (!meeting) {
      if (this.meetings.size >= MAX_MEETINGS)
        throw new CopilotBusyError(
          'The copilot is busy in too many meetings right now. Try again in a few minutes.'
        );
      const voice = new CopilotVoice(
        this.accounts,
        () => this.payerContext(sessionId),
        () => this.oursVoice()
      );
      meeting = new CopilotMeeting(sessionId, voice, payer);
      this.meetings.set(sessionId, meeting);
    }
    return meeting;
  }

  /**
   * An invited agent reads the meeting's transcript: the room listens (free
   * models) while any copilot or tap is open. `payer` is the inviter.
   */
  async tap(sessionId: string, participantId: string, name: string, payer: string): Promise<void> {
    const meeting = this.meetingFor(sessionId, payer);
    meeting.taps.set(participantId, { name, payer });
    await meeting.resync(await this.participants(sessionId));
    this.sweeper ??= setInterval(() => void this.sweep(), SWEEP_MS);
  }

  async untap(sessionId: string, participantId: string): Promise<void> {
    const meeting = this.meetings.get(sessionId);
    if (!meeting?.taps.delete(participantId)) return;
    await this.closeIfIdle(sessionId);
  }

  transcriptSince(sessionId: string, participantId: string, cursor: number) {
    const meeting = this.meetings.get(sessionId);
    if (!meeting?.taps.has(participantId)) return null;
    return meeting.linesSince(cursor);
  }

  private async closeIfIdle(sessionId: string): Promise<void> {
    const meeting = this.meetings.get(sessionId);
    if (!meeting) return;
    if (!meeting.liveAgents().length && !meeting.taps.size) {
      meeting.close();
      this.meetings.delete(sessionId);
    } else {
      await meeting.resync(await this.participants(sessionId));
    }
  }

  get(sessionId: string, userId: string): CopilotAgent | undefined {
    const agent = this.meetings.get(sessionId)?.agents.get(userId);
    return agent?.live ? agent : undefined;
  }

  /** Whose copilots, and which invited agents, are listening (shown to everyone). */
  active(sessionId: string): { name: string }[] {
    const meeting = this.meetings.get(sessionId);
    if (!meeting) return [];
    return [
      ...meeting.liveAgents().map((agent) => ({ name: agent.ownerName || 'A participant' })),
      ...[...meeting.taps.values()].map((tap) => ({ name: tap.name })),
    ];
  }

  listening(sessionId: string): number {
    return this.meetings.get(sessionId)?.listening ?? 0;
  }

  feed(sessionId: string, participant: string, client: string, pcm: Uint8Array) {
    return this.meetings.get(sessionId)?.feed(participant, client, pcm) ?? null;
  }

  async participants(
    sessionId: string
  ): Promise<(MeetingParticipant & { userId: string | null })[]> {
    const { data } = await this.db
      .from('session_participants')
      .select('id, display_name, user_id, kind')
      .eq('session_id', sessionId)
      .is('left_at', null);
    return ((data ?? []) as any[])
      .filter((row) => row.kind !== 'agent')
      .map((row) => ({
        id: row.id,
        // An empty display name reads as a guest, as everywhere else in the meeting.
        name:
          typeof row.display_name === 'string' && row.display_name.trim()
            ? row.display_name
            : 'Guest',
        userId: row.user_id ?? null,
      }));
  }

  /** Start, or resume, the owner's copilot in a live meeting. */
  async start(input: {
    sessionId: string;
    userId: string;
    participantId: string;
    role: CopilotRole;
    mode: CopilotMode;
    title: string | null;
  }): Promise<CopilotAgent> {
    const key = `${input.sessionId}:${input.userId}`;
    const pending = this.starting.get(key);
    if (pending) return pending;
    const work = this.open(input).finally(() => this.starting.delete(key));
    this.starting.set(key, work);
    return work;
  }

  private async open(input: {
    sessionId: string;
    userId: string;
    participantId: string;
    role: CopilotRole;
    mode: CopilotMode;
    title: string | null;
  }): Promise<CopilotAgent> {
    const running = this.get(input.sessionId, input.userId);
    if (running) {
      running.lastSeen = Date.now();
      return running;
    }
    if (!this.meetings.has(input.sessionId) && this.meetings.size >= MAX_MEETINGS)
      throw new CopilotBusyError(
        'The copilot is busy in too many meetings right now. Try again in a few minutes.'
      );
    const stored = await this.store.open(input);
    const meeting = this.meetingFor(input.sessionId, input.userId);
    await this.context(input.sessionId, input.userId, stored.state.mode);
    const agent: CopilotAgent = new CopilotAgent(stored.state, input.userId, stored.participantId, {
      llm: this.llm,
      store: this.store,
      ctx: (): Promise<ProviderContext> =>
        this.context(input.sessionId, input.userId, agent.state.mode),
    });
    const participants = await this.participants(input.sessionId);
    agent.ownerName =
      participants.find((one) => one.id === stored.participantId)?.name ??
      participants.find((one) => one.userId === input.userId)?.name ??
      '';
    meeting.agents.set(input.userId, agent);
    agent.start();
    await meeting.resync(participants);
    this.sweeper ??= setInterval(() => void this.sweep(), SWEEP_MS);
    return agent;
  }

  /** Stop the owner's copilot: follow-ups and review are written, then it is saved. */
  async stop(sessionId: string, userId: string): Promise<CopilotState | null> {
    const meeting = this.meetings.get(sessionId);
    const agent = meeting?.agents.get(userId);
    if (!meeting || !agent) return null;
    const state = await agent.finish();
    meeting.agents.delete(userId);
    this.contexts.delete(`${sessionId}:${userId}`);
    await this.closeIfIdle(sessionId);
    return state;
  }

  /**
   * A copilot the database says is live but this process does not run (a
   * redeploy or crash): resume it while the meeting is live, else finish it.
   */
  async recover(stored: StoredCopilot): Promise<CopilotAgent | CopilotState | null> {
    const { data: session } = await this.db
      .from('sessions')
      .select('status')
      .eq('id', stored.state.sessionId)
      .maybeSingle();
    if (session && session.status !== 'ended')
      return this.start({
        sessionId: stored.state.sessionId,
        userId: stored.userId,
        participantId: stored.participantId,
        role: stored.state.role,
        mode: stored.state.mode,
        title: stored.title,
      });
    return this.finishStored(stored);
  }

  /** Finish a copilot that is not running here (its meeting already ended). */
  async finishStored(stored: StoredCopilot): Promise<CopilotState> {
    const state = stored.state;
    if (state.status === 'ended') return state;
    const ctx = await this.context(state.sessionId, stored.userId, state.mode);
    state.status = 'ended';
    state.endedAt = new Date().toISOString();
    [state.followUps, state.review] = await Promise.all([
      writeFollowUps(this.llm, ctx, state, stored.participantId).catch(() => null),
      writeReview(this.llm, ctx, state, stored.participantId).catch(() => null),
    ]);
    this.contexts.delete(`${state.sessionId}:${stored.userId}`);
    await this.store.save(state);
    return state;
  }

  private async sweep(): Promise<void> {
    for (const [sessionId, meeting] of [...this.meetings]) {
      try {
        const { data: session } = await this.db
          .from('sessions')
          .select('status')
          .eq('id', sessionId)
          .maybeSingle();
        const ended = !session || session.status === 'ended';
        const now = Date.now();
        for (const agent of meeting.liveAgents()) {
          const abandoned = !agent.subscribers.size && now - agent.lastSeen > ABANDONED_MS;
          if (ended || abandoned) await this.stop(sessionId, agent.userId);
          else if (agent.subscribers.size) agent.lastSeen = now;
        }
        const tapped = [...meeting.taps.keys()];
        if (tapped.length) {
          const { data: present } = await this.db
            .from('session_participants')
            .select('id')
            .in('id', tapped)
            .is('left_at', null);
          const here = new Set(((present ?? []) as { id: string }[]).map((row) => row.id));
          for (const id of tapped) if (ended || !here.has(id)) meeting.taps.delete(id);
          await this.closeIfIdle(sessionId);
        }
        const still = this.meetings.get(sessionId);
        if (still) {
          for (const agent of still.liveAgents())
            await this.context(sessionId, agent.userId, agent.state.mode);
          await still.resync(await this.participants(sessionId));
        }
      } catch (error) {
        console.error('[copilot] sweep failed for', sessionId, error);
      }
    }
    if (!this.meetings.size && this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }
}

/** One per server process (route modules can be instantiated more than once). */
const KEY = Symbol.for('pairux.copilot');
export function copilotRuntime(): CopilotRuntime | null {
  if (process.env.PAIRUX_COPILOT === 'off') return null;
  const store = globalThis as unknown as Record<symbol, CopilotRuntime | undefined>;
  store[KEY] ??= new CopilotRuntime();
  return store[KEY];
}
