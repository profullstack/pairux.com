import { randomUUID } from 'node:crypto';
import type {
  CopilotEvent,
  CopilotFollowUps,
  CopilotReview,
  CopilotState,
  TranscriptLine,
} from '@pairux/meeting-copilot/types';
import { isThin, lastSeconds, mergeUpdate, placeholder, talkListen } from './analysis';
import { CopilotLlmError, type CopilotLlm } from './llm';
import {
  askSchema,
  clipLines,
  followUpsSchema,
  formatLines,
  recapSchema,
  reviewSchema,
  systemPrompt,
  updatePrompt,
  updateSchema,
} from './prompts';
import type { ProviderContext } from './providers';
import type { CopilotStore } from './store';

/** Update the notes at most this often while people talk... */
const UPDATE_EVERY_MS = 20_000;
/** ...or sooner when this many new lines piled up. */
const UPDATE_LINES = 12;
const SAVE_EVERY_MS = 30_000;
/** Prompt sizes, in characters of transcript. */
const LIVE_CONTEXT_CHARS = 2_000;
const FULL_CHARS = 40_000;

export interface AgentDeps {
  llm: CopilotLlm;
  store: CopilotStore;
  /** Fresh provider context (mode, keys, admin) for each model call. */
  ctx: () => Promise<ProviderContext>;
  now?: () => number;
}

/** One owner's copilot in one meeting. */
export class CopilotAgent {
  readonly subscribers = new Set<(event: CopilotEvent) => void>();
  /** Shown to everyone in the meeting: "AI copilot is listening for <name>". */
  ownerName = '';
  /** Last time the owner was connected or called the API (abandonment check). */
  lastSeen: number;
  private processed: number;
  private updating = false;
  private lastUpdate = 0;
  private lastSave = 0;
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(
    readonly state: CopilotState,
    readonly userId: string,
    readonly participantId: string,
    private readonly deps: AgentDeps
  ) {
    this.now = deps.now ?? Date.now;
    this.lastSeen = this.now();
    // A resumed copilot does not re-read lines its notes already cover.
    this.processed = state.transcript.length;
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), 5_000);
  }

  get live(): boolean {
    return this.state.status === 'live';
  }

  emit(event: CopilotEvent): void {
    for (const send of [...this.subscribers]) {
      try {
        send(event);
      } catch {
        this.subscribers.delete(send);
      }
    }
  }

  notice(message: string): void {
    if (this.state.notice === message) return;
    this.state.notice = message;
    this.emit({ type: 'notice', message });
  }

  setSttProvider(label: string): void {
    if (label && this.state.providers.stt !== label) {
      this.state.providers = { ...this.state.providers, stt: label };
      this.dirty = true;
    }
  }

  onLine(line: TranscriptLine): void {
    if (!this.live) return;
    this.state.transcript.push(line);
    this.dirty = true;
    this.emit({ type: 'line', line });
  }

  async tick(): Promise<void> {
    if (!this.live) return;
    const now = this.now();
    const pending = this.state.transcript.length - this.processed;
    if (
      !this.updating &&
      pending > 0 &&
      (now - this.lastUpdate >= UPDATE_EVERY_MS || pending >= UPDATE_LINES)
    )
      await this.update();
    if (this.dirty && now - this.lastSave >= SAVE_EVERY_MS) await this.save();
  }

  /** Rewrite the notes from the lines heard since the last update. */
  async update(): Promise<void> {
    if (this.updating) return;
    this.updating = true;
    this.lastUpdate = this.now();
    const upTo = this.state.transcript.length;
    const fresh = this.state.transcript.slice(this.processed, upTo);
    const context = clipLines(this.state.transcript.slice(0, this.processed), LIVE_CONTEXT_CHARS);
    try {
      const result = await this.deps.llm.run(await this.deps.ctx(), {
        name: 'copilot_update',
        system: systemPrompt(
          this.state.role,
          'Keep the owner’s live notes, open questions and key figures up to date, and suggest the next question when it helps.'
        ),
        prompt: updatePrompt({
          notes: this.state.notes,
          openQuestions: this.state.openQuestions,
          figures: this.state.figures,
          recentSuggestions: this.state.suggestions.slice(-6).map((one) => one.question),
          context,
          fresh,
          owner: this.participantId,
        }),
        schema: updateSchema,
        // Short, frequent updates: a CPU model writes ~20 tokens a second.
        maxTokens: 900,
        localTimeoutMs: 90_000,
      });
      if (!this.live) return;
      const merged = mergeUpdate(
        this.state,
        result.data,
        new Set(this.state.transcript.map((line) => line.id)),
        randomUUID,
        this.now()
      );
      this.processed = upTo;
      this.state.notes = merged.notes;
      this.state.openQuestions = merged.openQuestions;
      this.state.figures = merged.figures;
      this.state.providers = { ...this.state.providers, llm: result.provider };
      this.dirty = true;
      this.emit({
        type: 'notes',
        notes: merged.notes,
        openQuestions: merged.openQuestions,
        figures: merged.figures,
        providers: this.state.providers,
      });
      if (merged.suggestion) {
        this.state.suggestions.push(merged.suggestion);
        this.emit({ type: 'suggestion', suggestion: merged.suggestion });
      }
      if (this.state.notice.startsWith('AI notes paused')) this.notice('');
    } catch (error) {
      this.notice(`AI notes paused: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.updating = false;
    }
  }

  async ask(question: string): Promise<string> {
    this.lastSeen = this.now();
    const result = await this.deps.llm.run(await this.deps.ctx(), {
      name: 'copilot_ask',
      system: systemPrompt(
        this.state.role,
        'The owner is asking you privately during the meeting. Answer briefly and directly from the transcript and notes. If they ask you to draft something, draft it.'
      ),
      prompt: [
        `Notes: ${JSON.stringify(this.state.notes)}`,
        'Transcript:',
        formatLines(clipLines(this.state.transcript, FULL_CHARS), this.participantId) ||
          '(nothing heard yet)',
        `Owner's question: ${question}`,
      ].join('\n\n'),
      schema: askSchema,
      maxTokens: 1500,
    });
    return result.data.answer.trim();
  }

  async recap(seconds: number): Promise<string> {
    this.lastSeen = this.now();
    const lines = lastSeconds(this.state.transcript, seconds);
    if (!lines.length) return 'Nothing was said in that time.';
    const result = await this.deps.llm.run(await this.deps.ctx(), {
      name: 'copilot_recap',
      system: systemPrompt(
        this.state.role,
        'The owner zoned out for a moment. Recap what was just said in two or three short sentences, naming who said what.'
      ),
      prompt: formatLines(lines, this.participantId),
      schema: recapSchema,
      maxTokens: 600,
      localTimeoutMs: 20_000,
    });
    return result.data.recap.trim();
  }

  setQuestion(id: string, answered: boolean): boolean {
    const question = this.state.openQuestions.find((one) => one.id === id);
    if (!question) return false;
    question.status = answered ? 'answered' : 'open';
    this.dirty = true;
    this.emit({
      type: 'notes',
      notes: this.state.notes,
      openQuestions: this.state.openQuestions,
      figures: this.state.figures,
      providers: this.state.providers,
    });
    return true;
  }

  /** Stop listening, then write follow-ups and the review. */
  async finish(): Promise<CopilotState> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.live) return this.state;
    // Last notes pass over anything not yet folded in, before the status flips.
    if (this.state.transcript.length > this.processed) await this.update().catch(() => undefined);
    this.state.status = 'ended';
    this.state.endedAt = new Date(this.now()).toISOString();
    const ctx = await this.deps.ctx();
    const [followUps, review] = await Promise.all([
      writeFollowUps(this.deps.llm, ctx, this.state, this.participantId).catch((error: unknown) => {
        console.warn('[copilot] follow-ups failed:', error);
        return null;
      }),
      writeReview(this.deps.llm, ctx, this.state, this.participantId).catch((error: unknown) => {
        console.warn('[copilot] review failed:', error);
        return null;
      }),
    ]);
    this.state.followUps = followUps;
    this.state.review = review;
    this.state.notice = '';
    await this.save();
    this.emit({ type: 'ended', state: this.state });
    this.subscribers.clear();
    return this.state;
  }

  async save(): Promise<void> {
    this.lastSave = this.now();
    this.dirty = false;
    await this.deps.store.save(this.state);
  }
}

/** One-click follow-ups: action items and a recap message ready to send. */
export async function writeFollowUps(
  llm: CopilotLlm,
  ctx: ProviderContext,
  state: CopilotState,
  owner: string
): Promise<CopilotFollowUps | null> {
  if (!state.transcript.length) return null;
  const result = await llm.run(ctx, {
    name: 'copilot_follow_ups',
    system: systemPrompt(
      state.role,
      'The meeting is over. List the follow-up action items (owner and due date only when they were said) and write a short recap message the owner can send to the other participants.'
    ),
    prompt: [
      `Notes: ${JSON.stringify(state.notes)}`,
      `Open questions: ${JSON.stringify(state.openQuestions.filter((one) => one.status === 'open').map((one) => one.text))}`,
      'Transcript:',
      formatLines(clipLines(state.transcript, FULL_CHARS), owner),
    ].join('\n\n'),
    schema: followUpsSchema,
    maxTokens: 2500,
    localTimeoutMs: 90_000,
  });
  return {
    actionItems: result.data.actionItems
      .map((item) => ({
        text: item.text.trim(),
        ...(placeholder(item.owner) ? { owner: placeholder(item.owner) } : {}),
        ...(placeholder(item.due) ? { due: placeholder(item.due) } : {}),
      }))
      .filter((item) => item.text),
    message: result.data.message.trim(),
  };
}

/** The offline self-assessment; says so when the transcript is too thin to judge. */
export async function writeReview(
  llm: CopilotLlm,
  ctx: ProviderContext,
  state: CopilotState,
  owner: string
): Promise<CopilotReview> {
  const balance = talkListen(state.transcript, owner);
  const questions = {
    asked: state.openQuestions.length,
    answered: state.openQuestions.filter((one) => one.status === 'answered').length,
  };
  if (isThin(state.transcript))
    return {
      thin: true,
      focusArea: '',
      feedback: [],
      talkListen: balance,
      questions,
      followUpClarity: 'unclear',
      note: 'The transcript is too short to review this conversation fairly.',
    };
  try {
    const result = await llm.run(ctx, {
      name: 'copilot_review',
      system: systemPrompt(
        state.role,
        'Review how the owner ran this conversation, for their eyes only: one focus area for next time and two to four concrete observations, quoting the transcript. Be kind and specific.'
      ),
      prompt: [
        `Owner's share of talking time: ${String(Math.round(balance.you * 100))}%.`,
        `Questions raised: ${String(questions.asked)}, answered: ${String(questions.answered)}.`,
        `Notes: ${JSON.stringify(state.notes)}`,
        'Transcript:',
        formatLines(clipLines(state.transcript, FULL_CHARS), owner),
      ].join('\n\n'),
      schema: reviewSchema,
      maxTokens: 2000,
      localTimeoutMs: 90_000,
    });
    return {
      thin: false,
      focusArea: result.data.focusArea.trim(),
      feedback: result.data.feedback.map((one) => one.trim()).filter(Boolean),
      talkListen: balance,
      questions,
      followUpClarity: result.data.followUpClarity,
      ...(result.data.note.trim() ? { note: result.data.note.trim() } : {}),
    };
  } catch (error) {
    if (error instanceof CopilotLlmError)
      return {
        thin: false,
        focusArea: '',
        feedback: [],
        talkListen: balance,
        questions,
        followUpClarity: 'unclear',
        note: `The review could not be written: ${error.message}`,
      };
    throw error;
  }
}
