/**
 * `pairux copilot ...`: drive your AI meeting copilot from the terminal.
 *
 *   pairux copilot start ABC123 --role sales
 *   pairux copilot watch ABC123          live transcript, suggestions, notices
 *   pairux copilot ask ABC123 "What did they say the budget was?"
 *   pairux copilot stop ABC123           follow-ups + conversation review
 *
 * A <meeting> is a session id, a 6-character join code or a meeting URL; with
 * none, the session of the agent this CLI joined (`pairux join`) is used. Every
 * call is signed in with the `pairux login` token; the copilot is per user.
 */
import { parseArgs } from 'node:util';
import { COPILOT_ROLE_DEFS } from '@pairux/meeting-copilot/roles';
import {
  COPILOT_MODES,
  COPILOT_ROLES,
  isCopilotMode,
  isCopilotRole,
  type CopilotEvent,
  type CopilotNotes,
  type CopilotReview,
  type CopilotState,
  type CopilotFollowUps,
} from '@pairux/meeting-copilot/types';
import {
  ApiError,
  KEY_PROVIDERS,
  type CopilotApi,
  type CopilotSettingsPatch,
  type CopilotSettingsView,
  type CopilotSummary,
  type CopilotWallet,
  type PairuxClient,
} from './api';
import type { CliConfig } from './config';
import type { Deps } from './commands';
import { UsageError } from './errors';

export const RECONNECT_MS = 3_000;

export const COPILOT_HELP = `AI meeting copilot (PairUX Pro/Team): listens to a meeting you are in and
keeps notes, suggests questions, answers questions about the call and writes
the follow-ups. Sign in first with \`pairux login\`.

Usage:
  pairux copilot status [meeting] [--json]       Who has a copilot listening; yours
  pairux copilot start [meeting] [--role R] [--mode M] [--json]
                                                 Start (or resume) your copilot
  pairux copilot stop [meeting] [--json]         Stop it; print follow-ups and review
  pairux copilot watch [meeting] [--json] [--all]
                                                 Stream it live: transcript, suggested
                                                 questions, notes, notices. Reconnects
                                                 on its own; Ctrl-C to stop watching.
  pairux copilot notes [meeting|copilot-id] [--json]
                                                 Notes, open questions, key figures
  pairux copilot ask [meeting] <question...> [--json]
                                                 Ask about the call so far
  pairux copilot recap [meeting] [--seconds N] [--json]
                                                 What was said in the last N seconds
  pairux copilot followups <copilot-id|meeting> [--json]
                                                 (Re)write the follow-ups
  pairux copilot review <copilot-id|meeting> [--json]
                                                 (Re)write the conversation review
  pairux copilot list [--json]                   Your past and live copilots
  pairux copilot settings [--json] [--mode M] [--role R]
      [--anthropic-key K | --clear-anthropic-key]
      [--openai-key K | --clear-openai-key]
      [--elevenlabs-key K | --clear-elevenlabs-key]
                                                 Show or change defaults and own keys
                                                 (a key of "-" is read from stdin)
  pairux copilot wallet [--json]                 Pay-as-you-go balance and charges

A meeting is a session id, a 6-character join code or a meeting URL. Left out,
it is the session of the agent this CLI joined with \`pairux join\`.

Roles: ${COPILOT_ROLES.join(', ')}
Modes: auto (free models, paid cloud when they fail), free (never charged),
       byok (your own keys first), cloud (own key, else pay as you go, first)`;

// ---------------------------------------------------------------------------
// Meeting references

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOIN_CODE = /^[A-Z0-9]{6}$/i;

export type MeetingRef = { sessionId: string } | { joinCode: string };

/** A session id, a join code, or a URL carrying either; null when it is none of them. */
export function parseMeetingRef(input: string): MeetingRef | null {
  const value = input.trim();
  if (UUID.test(value)) return { sessionId: value.toLowerCase() };
  if (JOIN_CODE.test(value)) return { joinCode: value.toUpperCase() };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'pairux:') {
    return null;
  }
  // pairux://join/ABC123 puts "join" in the host.
  const segments = [url.host, ...url.pathname.split('/')].filter(Boolean);
  const id = segments.find((s) => UUID.test(s));
  if (id) return { sessionId: id.toLowerCase() };
  const joinAt = segments.indexOf('join');
  const code = joinAt >= 0 ? segments[joinAt + 1] : segments.at(-1);
  if (code && JOIN_CODE.test(code)) return { joinCode: code.toUpperCase() };
  const fromQuery = url.searchParams.get('code') ?? url.searchParams.get('joinCode');
  if (fromQuery && JOIN_CODE.test(fromQuery)) return { joinCode: fromQuery.toUpperCase() };
  return null;
}

// ---------------------------------------------------------------------------
// Server-sent events

/**
 * Parse a text/event-stream body into its `data:` JSON payloads. Comments
 * (`: copilot` heartbeats) and malformed events are skipped.
 */
export async function* readSseEvents<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = function* (block: string): Generator<T> {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    try {
      yield JSON.parse(data) as T;
    } catch {
      /* a malformed event is skipped, not fatal */
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
      let split = buffer.indexOf('\n\n');
      while (split >= 0) {
        yield* flush(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) yield* flush(buffer);
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Formatting (pure, so tests check the exact text)

const pct = (share: number) => `${String(Math.round(share * 100))}%`;

function roleLabel(role: string): string {
  return isCopilotRole(role) ? COPILOT_ROLE_DEFS[role].label : role;
}

export function formatProviders(state: Pick<CopilotState, 'providers'>): string | null {
  const parts = [
    state.providers.stt ? `speech: ${state.providers.stt}` : null,
    state.providers.llm ? `notes: ${state.providers.llm}` : null,
  ].filter(Boolean);
  return parts.length ? `Providers: ${parts.join(', ')}` : null;
}

export function formatStarted(state: CopilotState, meeting: string): string[] {
  const lines = [
    `Copilot ${state.status === 'live' ? 'listening' : state.status} in ${meeting} as ${roleLabel(state.role)} (mode: ${state.mode}).`,
  ];
  if (isCopilotRole(state.role)) {
    lines.push('Listens for:');
    for (const item of COPILOT_ROLE_DEFS[state.role].listensFor) lines.push(`  - ${item}`);
  }
  const providers = formatProviders(state);
  if (providers) lines.push(providers);
  if (state.notice) lines.push(`! ${state.notice}`);
  return lines;
}

export function formatNotes(
  state: Pick<CopilotState, 'notes' | 'openQuestions' | 'figures'>,
  title?: string | null
): string[] {
  const n: CopilotNotes = state.notes;
  const lines: string[] = [];
  if (title) lines.push(title);
  lines.push(`Summary: ${n.summary || '(nothing yet)'}`);
  const list = (heading: string, items: string[]) => {
    if (!items.length) return;
    lines.push(`${heading}:`);
    for (const item of items) lines.push(`  - ${item}`);
  };
  list('Key points', n.keyPoints);
  list('Decisions', n.decisions);
  list(
    'Action items',
    n.actionItems.map((a) => {
      const meta = [a.owner, a.due ? `due ${a.due}` : null].filter(Boolean).join(', ');
      return meta ? `${a.text} (${meta})` : a.text;
    })
  );
  if (state.openQuestions.length) {
    lines.push('Questions:');
    for (const q of state.openQuestions) {
      lines.push(`  [${q.status}] ${q.text}${q.answer ? ` -> ${q.answer}` : ''}`);
    }
  }
  if (state.figures.length) {
    lines.push('Key figures:');
    for (const f of state.figures) {
      lines.push(`  ${f.kind}: ${f.value}${f.context ? ` (${f.context})` : ''}`);
    }
  }
  return lines;
}

export function formatFollowUps(followUps: CopilotFollowUps | null): string[] {
  if (!followUps) return ['Follow-ups: nothing was heard to follow up on.'];
  const lines = ['Follow-ups:'];
  if (!followUps.actionItems.length) lines.push('  (no action items)');
  for (const a of followUps.actionItems) {
    const meta = [a.owner, a.due ? `due ${a.due}` : null].filter(Boolean).join(', ');
    lines.push(`  - ${a.text}${meta ? ` (${meta})` : ''}`);
  }
  if (followUps.message) {
    lines.push('', 'Recap message:', ...followUps.message.split('\n').map((l) => `  ${l}`));
  }
  return lines;
}

export function formatReview(review: CopilotReview | null): string[] {
  if (!review) return ['Review: not written yet.'];
  if (review.thin) {
    return [`Review: too thin to review${review.note ? ` (${review.note})` : '.'}`];
  }
  const lines = [
    'Review:',
    `  Focus: ${review.focusArea}`,
    `  Talk/listen: you ${pct(review.talkListen.you)}, others ${pct(review.talkListen.others)}`,
    `  Questions: ${String(review.questions.asked)} asked, ${String(review.questions.answered)} answered`,
    `  Follow-up clarity: ${review.followUpClarity}`,
  ];
  for (const item of review.feedback) lines.push(`  - ${item}`);
  if (review.note) lines.push(`  ${review.note}`);
  return lines;
}

function shortDate(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '';
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function formatList(copilots: CopilotSummary[]): string[] {
  if (!copilots.length)
    return ['No copilots yet. Start one with `pairux copilot start <meeting>`.'];
  const rows = copilots.map((c) => [
    shortDate(c.startedAt),
    c.status,
    c.role,
    c.id,
    clip(c.title ?? c.summary, 60),
  ]);
  const header = ['STARTED', 'STATUS', 'ROLE', 'ID', 'TITLE'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return [line(header), ...rows.map(line)];
}

export function formatSettings(s: CopilotSettingsView): string[] {
  const lines = [`Mode: ${s.mode}`, `Role: ${s.role} (${roleLabel(s.role)})`, 'Own keys:'];
  for (const provider of KEY_PROVIDERS) {
    const key = s.keys[provider] as { set: boolean; last4: string | null } | undefined;
    lines.push(
      `  ${provider}: ${key?.set ? `set (…${key.last4 ?? '????'})` : 'not set'}`.trimEnd()
    );
  }
  if (s.byokAvailable === false) lines.push('  (own keys are not enabled on this server)');
  if (s.passphraseSet === false)
    lines.push('  (set a key passphrase at https://pairux.com/settings/copilot to save own keys)');
  if (s.eligible === false) lines.push('The copilot is part of PairUX Pro and Team.');
  if (s.balance !== undefined) lines.push(`Pay-as-you-go balance: ${s.balance}`);
  return lines;
}

export function formatWallet(w: CopilotWallet): string[] {
  const lines = [
    `Balance: ${w.balance}`,
    `Pay-as-you-go charges are the provider's cost + ${String(Math.round((w.markup - 1) * 100))}%.`,
    `Top-ups: ${w.topups.map((t) => `$${String(t.priceUsd)}`).join(', ')}`,
  ];
  if (!w.usage.length) {
    lines.push('No charges yet.');
    return lines;
  }
  lines.push('Recent charges:');
  for (const u of w.usage) {
    lines.push(
      `  ${shortDate(u.at)}  ${u.charge.padStart(8)}  ${u.provider} ${u.kind} (${String(u.units)})${u.status === 'charged' ? '' : ` [${u.status}]`}`
    );
  }
  return lines;
}

/** Follows a stream across reconnects and turns events into terminal lines. */
export class WatchPrinter {
  private readonly lines = new Set<string>();
  private readonly suggestions = new Set<string>();
  private notesKey = '';
  private connected = false;

  constructor(private readonly opts: { backlog: number }) {}

  print(event: CopilotEvent): string[] {
    switch (event.type) {
      case 'state': {
        const s = event.state;
        const out: string[] = [];
        if (!this.connected) {
          out.push(
            `* Copilot ${s.status} as ${roleLabel(s.role)} (mode: ${s.mode}), ${String(s.transcript.length)} lines so far.`
          );
          const providers = formatProviders(s);
          if (providers) out.push(`* ${providers}`);
        }
        const fresh = s.transcript.filter((l) => !this.lines.has(l.id));
        const shown = this.connected ? fresh : fresh.slice(-this.opts.backlog);
        for (const l of fresh) this.lines.add(l.id);
        for (const l of shown) out.push(`${l.name}: ${l.text}`);
        const freshS = s.suggestions.filter((q) => !this.suggestions.has(q.id));
        const shownS = this.connected ? freshS : freshS.slice(-Math.min(3, this.opts.backlog));
        for (const q of freshS) this.suggestions.add(q.id);
        for (const q of shownS) out.push(`? ${q.question} (why: ${q.reason})`);
        this.notesKey = this.notesSummary(s.notes, s.openQuestions.length);
        if (!this.connected && s.notice) out.push(`! ${s.notice}`);
        this.connected = true;
        return out;
      }
      case 'line':
        if (this.lines.has(event.line.id)) return [];
        this.lines.add(event.line.id);
        return [`${event.line.name}: ${event.line.text}`];
      case 'suggestion':
        if (this.suggestions.has(event.suggestion.id)) return [];
        this.suggestions.add(event.suggestion.id);
        return [`? ${event.suggestion.question} (why: ${event.suggestion.reason})`];
      case 'notes': {
        const key = this.notesSummary(event.notes, event.openQuestions.length);
        if (key === this.notesKey) return [];
        this.notesKey = key;
        return [`~ Notes: ${key}`];
      }
      case 'notice':
        return [`! ${event.message}`];
      case 'ended':
        return [
          '* Copilot ended.',
          `  Follow-ups and review: \`pairux copilot notes ${event.state.id}\`, \`pairux copilot followups ${event.state.id}\`, \`pairux copilot review ${event.state.id}\`.`,
        ];
    }
  }

  private notesSummary(notes: CopilotNotes, openQuestions: number): string {
    const count = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;
    return [
      count(notes.keyPoints.length, 'key point'),
      count(notes.decisions.length, 'decision'),
      count(notes.actionItems.length, 'action item'),
      count(openQuestions, 'question'),
    ].join(', ');
  }
}

// ---------------------------------------------------------------------------
// Commands

export interface CopilotContext {
  deps: Deps;
  client: PairuxClient;
  config: CliConfig;
}

const json = { type: 'boolean', default: false } as const;

export async function runCopilot(argv: string[], ctx: CopilotContext): Promise<number> {
  const { deps, client, config } = ctx;
  const sub = argv.at(0);
  const rest = argv.slice(1);
  const api: CopilotApi = client.copilot();
  const out = (lines: string[]) => {
    for (const line of lines) deps.out(line);
  };
  const emitJson = (value: unknown) => {
    deps.out(JSON.stringify(value));
  };

  /** The meeting a command is about: the argument, else the joined agent's session. */
  const resolveSession = async (arg: string | undefined): Promise<string> => {
    if (!arg) {
      if (config.agent) return config.agent.sessionId;
      throw new UsageError(
        `Which meeting? Pass a session id, join code or meeting URL: pairux copilot ${sub ?? ''} <meeting>`
      );
    }
    const ref = parseMeetingRef(arg);
    if (!ref) throw new UsageError(`"${arg}" is not a session id, join code or meeting URL.`);
    if ('sessionId' in ref) return ref.sessionId;
    const found = await client.lookupJoinCode(ref.joinCode).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) {
        throw new UsageError(`No live meeting has the join code ${ref.joinCode}.`);
      }
      throw error;
    });
    if (found.scheduled) throw new UsageError(`Meeting ${ref.joinCode} has not started yet.`);
    return found.id;
  };

  /** A copilot id, or the newest copilot of yours in the meeting the argument names. */
  const resolveCopilot = async (
    arg: string | undefined
  ): Promise<{ id: string; copilot?: CopilotState; title?: string | null }> => {
    if (arg && UUID.test(arg.trim())) {
      try {
        const got = await api.get(arg.trim().toLowerCase());
        return { id: got.copilot.id, copilot: got.copilot, title: got.title };
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    }
    const sessionId = await resolveSession(arg);
    const { copilots } = await api.list();
    const mine = copilots.find((c) => c.sessionId === sessionId);
    if (!mine) throw new UsageError('You have no copilot in that meeting.');
    return { id: mine.id };
  };

  switch (sub) {
    case 'status': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { json },
      });
      const status = await api.status(await resolveSession(positionals[0]));
      if (values.json) {
        emitJson(status);
        return 0;
      }
      if (!status.available) {
        deps.out('The AI copilot is not available on this server.');
        return 1;
      }
      deps.out(
        status.active.length
          ? `Listening: ${status.active.map((a) => a.name).join(', ')}`
          : 'No copilot is listening in this meeting.'
      );
      if (status.mine) {
        deps.out(
          `Yours: ${status.mine.status} as ${roleLabel(status.mine.role)} (mode: ${status.mine.mode}), id ${status.mine.id}`
        );
      } else if (!status.eligible) {
        deps.out(
          `The copilot is part of PairUX Pro and Team.${status.upgradeUrl ? ` Upgrade: ${absolute(client, status.upgradeUrl)}` : ''}`
        );
      } else {
        deps.out(`Yours: not running. Defaults: ${status.role}, mode ${status.mode}.`);
      }
      return 0;
    }

    case 'start': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { role: { type: 'string' }, mode: { type: 'string' }, json },
      });
      if (values.role !== undefined && !isCopilotRole(values.role)) {
        throw new UsageError(`--role must be one of: ${COPILOT_ROLES.join(', ')}`);
      }
      if (values.mode !== undefined && !isCopilotMode(values.mode)) {
        throw new UsageError(`--mode must be one of: ${COPILOT_MODES.join(', ')}`);
      }
      const sessionId = await resolveSession(positionals[0]);
      const state = await api.start(sessionId, {
        ...(values.role ? { role: values.role } : {}),
        ...(values.mode ? { mode: values.mode } : {}),
      });
      if (values.json) {
        emitJson(state);
        return 0;
      }
      out(formatStarted(state, positionals[0] ?? sessionId));
      const target = positionals[0] ? ` ${positionals[0]}` : '';
      deps.out(`Run \`pairux copilot watch${target}\` to follow it live.`);
      return 0;
    }

    case 'stop': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { json },
      });
      const state = await api.stop(await resolveSession(positionals[0]));
      if (values.json) {
        emitJson(state);
        return 0;
      }
      deps.out(`Copilot stopped (id ${state.id}).`);
      out(formatFollowUps(state.followUps));
      deps.out('');
      out(formatReview(state.review));
      return 0;
    }

    case 'watch': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { json, all: { type: 'boolean', default: false } },
      });
      const sessionId = await resolveSession(positionals[0]);
      const printer = new WatchPrinter({ backlog: values.all ? Infinity : 10 });
      let streams = 0;
      for (;;) {
        streams += 1;
        try {
          const body = await api.stream(sessionId);
          for await (const event of readSseEvents<CopilotEvent>(body)) {
            if (values.json) emitJson(event);
            else out(printer.print(event));
            if (event.type === 'ended') return 0;
          }
        } catch (error) {
          if (error instanceof ApiError && error.status === 404 && streams > 1) {
            // It stopped (or was stopped elsewhere) while the stream was down.
            if (values.json) emitJson({ type: 'ended', reason: error.message });
            else deps.out(`* ${error.message}`);
            return 0;
          }
          if (error instanceof ApiError && !retryable(error.status)) throw error;
          if (deps.maxStreams !== undefined && streams >= deps.maxStreams) throw error;
          deps.err(
            `Copilot stream dropped (${error instanceof Error ? error.message : String(error)}); reconnecting in ${String(RECONNECT_MS / 1000)} s.`
          );
          await deps.sleep(RECONNECT_MS);
          continue;
        }
        if (deps.maxStreams !== undefined && streams >= deps.maxStreams) return 0;
        deps.err(`Copilot stream closed; reconnecting in ${String(RECONNECT_MS / 1000)} s.`);
        await deps.sleep(RECONNECT_MS);
      }
    }

    case 'notes': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { json },
      });
      const found = await resolveCopilot(positionals[0]);
      const { copilot: state, title } = found.copilot
        ? { copilot: found.copilot, title: found.title ?? null }
        : await api.get(found.id);
      if (values.json) {
        emitJson({ ...state, title });
        return 0;
      }
      out(formatNotes(state, title));
      return 0;
    }

    case 'ask': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { json },
      });
      // `ask "question"` uses the joined session; `ask <meeting> question...` names one.
      const first = positionals.at(0);
      const named = first !== undefined && positionals.length > 1 && parseMeetingRef(first);
      const words = named ? positionals.slice(1) : positionals;
      let question = words.join(' ').trim();
      if (question === '-') question = ((await deps.readStdin()) ?? '').trim();
      if (!question) throw new UsageError('Usage: pairux copilot ask [meeting] <question>');
      const sessionId = await resolveSession(named ? first : undefined);
      const { answer } = await api.ask(sessionId, question);
      if (values.json) emitJson({ question, answer });
      else deps.out(answer);
      return 0;
    }

    case 'recap': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { json, seconds: { type: 'string' } },
      });
      let seconds: number | undefined;
      if (values.seconds !== undefined) {
        seconds = Number(values.seconds);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          throw new UsageError('--seconds must be a positive number (10 to 300).');
        }
      }
      const r = await api.recap(await resolveSession(positionals[0]), seconds);
      if (values.json) emitJson(r);
      else deps.out(`Last ${String(r.seconds)} s: ${r.recap}`);
      return 0;
    }

    case 'followups':
    case 'follow-ups':
    case 'review': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { json },
      });
      if (!positionals[0] && !config.agent) {
        throw new UsageError(`Usage: pairux copilot ${sub} <copilot-id|meeting>`);
      }
      const { id } = await resolveCopilot(positionals[0]);
      const written = await api.write(id, sub === 'review' ? 'review' : 'follow-ups');
      if (values.json) {
        emitJson(written);
        return 0;
      }
      out(sub === 'review' ? formatReview(written.review) : formatFollowUps(written.followUps));
      return 0;
    }

    case 'list': {
      const { values } = parseArgs({ args: rest, options: { json } });
      const { copilots } = await api.list();
      if (values.json) emitJson(copilots);
      else out(formatList(copilots));
      return 0;
    }

    case 'settings': {
      const keyOptions = {
        'anthropic-key': { type: 'string' },
        'clear-anthropic-key': { type: 'boolean', default: false },
        'openai-key': { type: 'string' },
        'clear-openai-key': { type: 'boolean', default: false },
        'elevenlabs-key': { type: 'string' },
        'clear-elevenlabs-key': { type: 'boolean', default: false },
      } as const;
      const { values } = parseArgs({
        args: rest,
        options: { json, mode: { type: 'string' }, role: { type: 'string' }, ...keyOptions },
      });
      const v = values as Record<string, string | boolean | undefined>;
      const patch: CopilotSettingsPatch = {};
      if (v.mode !== undefined) {
        if (!isCopilotMode(v.mode)) {
          throw new UsageError(`--mode must be one of: ${COPILOT_MODES.join(', ')}`);
        }
        patch.mode = v.mode;
      }
      if (v.role !== undefined) {
        if (!isCopilotRole(v.role)) {
          throw new UsageError(`--role must be one of: ${COPILOT_ROLES.join(', ')}`);
        }
        patch.role = v.role;
      }
      const keys: NonNullable<CopilotSettingsPatch['keys']> = {};
      for (const provider of KEY_PROVIDERS) {
        const set = v[`${provider}-key`];
        const clear = v[`clear-${provider}-key`] === true;
        if (typeof set === 'string' && clear) {
          throw new UsageError(
            `Pass either --${provider}-key or --clear-${provider}-key, not both.`
          );
        }
        if (clear) keys[provider] = null;
        else if (typeof set === 'string') {
          const key = set === '-' ? ((await deps.readStdin()) ?? '').trim() : set.trim();
          if (!key) throw new UsageError(`--${provider}-key is empty.`);
          keys[provider] = key;
        }
      }
      if (Object.keys(keys).length) patch.keys = keys;
      const changing = Object.keys(patch).length > 0;
      const settings = changing ? await api.saveSettings(patch) : await api.settings();
      if (v.json) {
        emitJson(settings);
        return 0;
      }
      if (changing) deps.out('Saved.');
      out(formatSettings(settings));
      return 0;
    }

    case 'wallet': {
      const { values } = parseArgs({ args: rest, options: { json } });
      const wallet = await api.wallet();
      if (values.json) emitJson(wallet);
      else out(formatWallet(wallet));
      return 0;
    }

    default:
      throw new UsageError(`Unknown copilot command "${sub ?? ''}". Run \`pairux copilot help\`.`);
  }
}

/** Worth reconnecting: server trouble, rate limits and timeouts, not a refusal. */
function retryable(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

function absolute(client: PairuxClient, path: string): string {
  return path.startsWith('http') ? path : `${client.baseUrl}${path}`;
}
