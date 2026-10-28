import {
  RoomTranslator,
  SpeechError,
  type LiveVoice,
  type RoomChoice,
  type RoomListener,
  type SharedEvent,
  type TextTranslator,
} from '@profullstack/live-translate';
import type { TranscriptLine } from '@pairux/meeting-copilot/types';
import type { CopilotAgent } from './agent';
import type { CopilotVoice } from './voice';

/** The copilot room only transcribes; it never asks for a translation. */
/** Transcript lines kept in memory for invited agents (about an hour of talk). */
const MAX_TAP_LINES = 2000;

const NO_TRANSLATION: TextTranslator = {
  translate: () => Promise.reject(new SpeechError('The copilot does not translate.', 400)),
};

export interface MeetingParticipant {
  id: string;
  name: string;
}

/**
 * Everything the copilots in one meeting share: one transcription room (an
 * invisible listener on every participant, fed by the clients' existing
 * translation uploads) and the transcript, fanned out to each owner's agent.
 */
export class CopilotMeeting {
  readonly agents = new Map<string, CopilotAgent>();
  /**
   * Invited agents reading the transcript (participant id -> name and payer).
   * They keep the room listening without a copilot of their own.
   */
  readonly taps = new Map<string, { name: string; payer: string }>();
  /** The transcript for taps: a window of recent lines and the count of all lines ever heard. */
  private readonly lines: TranscriptLine[] = [];
  private heard = 0;
  private readonly room: RoomTranslator;
  private readonly names = new Map<string, string>();
  private listener: RoomListener | null = null;
  private leave: (() => void) | null = null;
  private wantedKey = '';

  constructor(
    readonly sessionId: string,
    private readonly voice: CopilotVoice,
    payer: string
  ) {
    this.room = new RoomTranslator({
      room: sessionId,
      payer,
      // CopilotVoice implements the two methods RoomTranslator calls (available, hear).
      voice: voice as unknown as LiveVoice,
      translator: NO_TRANSLATION,
    });
  }

  /** How many listeners the clients see (any copilot turns their feeders on). */
  get listening(): number {
    return this.room.size;
  }

  feed(participant: string, client: string, pcm: Uint8Array) {
    return this.room.feed(participant, client, pcm);
  }

  liveAgents(): CopilotAgent[] {
    return [...this.agents.values()].filter((agent) => agent.live);
  }

  /**
   * Listen to exactly these participants. Also restores anyone the room
   * dropped after repeated recognition failures.
   */
  async resync(participants: MeetingParticipant[]): Promise<void> {
    for (const one of participants) this.names.set(one.id, one.name);
    if (!this.liveAgents().length && !this.taps.size) {
      this.stopListening();
      return;
    }
    const ids = participants.map((one) => one.id).sort();
    const key = ids.join(',');
    const healthy = this.listener?.choices.length === ids.length && key === this.wantedKey;
    if (healthy) return;
    this.stopListening();
    if (!ids.length) return;
    const choices: RoomChoice[] = ids.map((participant) => ({
      participant,
      from: '',
      to: '',
      audio: false,
      text: true,
    }));
    const listener: RoomListener = {
      id: `copilot:${this.sessionId}`,
      choices,
      send: (event) => {
        this.onEvent(event);
      },
      close: () => {
        if (this.listener === listener) {
          this.listener = null;
          this.leave = null;
        }
      },
    };
    this.listener = listener;
    this.wantedKey = key;
    try {
      this.leave = await this.room.listen(listener);
    } catch (error) {
      this.listener = null;
      this.wantedKey = '';
      const message = error instanceof Error ? error.message : String(error);
      for (const agent of this.liveAgents()) agent.notice(`Not listening: ${message}`);
    }
  }

  private onEvent(event: SharedEvent): void {
    if (event.type === 'line' && event.participant) {
      const text = event.line.text.trim();
      if (!text) return;
      const line: TranscriptLine = {
        id: event.id,
        participant: event.participant,
        name: this.names.get(event.participant) ?? 'Someone',
        text,
        at: Math.round(event.line.at),
        until: Math.round(event.line.until),
        ...(event.line.language ? { language: event.line.language } : {}),
      };
      this.lines.push(line);
      this.heard++;
      if (this.lines.length > MAX_TAP_LINES)
        this.lines.splice(0, this.lines.length - MAX_TAP_LINES);
      for (const agent of this.liveAgents()) {
        agent.setSttProvider(this.voice.current);
        agent.onLine(line);
      }
    } else if (event.type === 'error') {
      const who = event.participant
        ? (this.names.get(event.participant) ?? 'someone')
        : 'the meeting';
      for (const agent of this.liveAgents())
        agent.notice(`Could not hear ${who}: ${this.voice.problem || event.error}`);
    }
  }

  /**
   * Lines heard after `cursor` (a count of lines heard, 0 = the start) and the
   * cursor to pass next time. A reader that fell behind the window gets the
   * oldest lines still kept.
   */
  linesSince(cursor: number): { lines: TranscriptLine[]; cursor: number } {
    const first = this.heard - this.lines.length;
    const from = Math.max(0, Math.min(this.lines.length, cursor - first));
    return { lines: this.lines.slice(from), cursor: this.heard };
  }

  private stopListening(): void {
    const leave = this.leave;
    this.leave = null;
    this.listener = null;
    this.wantedKey = '';
    leave?.();
  }

  close(): void {
    this.stopListening();
    this.room.close();
  }
}
