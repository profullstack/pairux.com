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
    if (!this.liveAgents().length) {
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
