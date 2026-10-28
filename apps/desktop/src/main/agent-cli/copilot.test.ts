import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CopilotEvent, CopilotState } from '@pairux/meeting-copilot/types';
import { run, type Deps } from './commands';
import { saveConfig, type CliConfig } from './config';
import {
  WatchPrinter,
  formatList,
  formatNotes,
  formatReview,
  parseMeetingRef,
  readSseEvents,
} from './copilot';

interface Call {
  method: string;
  path: string;
  body: string | null;
  auth: string | null;
}

/** A JSON reply, or an SSE body sent as these chunks, or a network failure. */
type Reply = { status: number; body: unknown } | { sse: string[] } | { fail: string };
type Handler = (call: Call) => Reply;

const SESSION = '22222222-2222-4222-8222-222222222222';
const COPILOT = '33333333-3333-4333-8333-333333333333';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function fakeFetch(handler: Handler, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    );
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      body: typeof init?.body === 'string' ? init.body : null,
      auth: 'Authorization' in headers ? headers.Authorization : null,
    };
    calls.push(call);
    const reply = handler(call);
    if ('fail' in reply) throw new TypeError(reply.fail);
    if ('sse' in reply) {
      return new Response(streamOf(reply.sse), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch;
}

let dir: string;
let out: string[];
let err: string[];
let calls: Call[];
let sleeps: number[];

function deps(handler: Handler, extra: Partial<Deps> = {}): Deps {
  return {
    env: { PAIRUX_API_URL: 'https://pairux.test' },
    configPath: join(dir, 'config.json'),
    fetchImpl: fakeFetch(handler, calls),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    openBrowser: () => undefined,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    readStdin: () => Promise.resolve(null),
    ...extra,
  };
}

async function signIn(extra: Partial<CliConfig> = {}) {
  await saveConfig(
    {
      tokens: { accessToken: 'pux_at_x', refreshToken: 'pux_rt_x', expiresAt: Date.now() + 3e6 },
      ...extra,
    },
    join(dir, 'config.json')
  );
}

function state(over: Partial<CopilotState> = {}): CopilotState {
  return {
    id: COPILOT,
    sessionId: SESSION,
    role: 'sales',
    mode: 'auto',
    status: 'live',
    notes: { summary: '', keyPoints: [], decisions: [], actionItems: [] },
    suggestions: [],
    openQuestions: [],
    figures: [],
    transcript: [],
    followUps: null,
    review: null,
    providers: { stt: 'whisper (free)', llm: 'claude (own key)' },
    notice: '',
    startedAt: '2026-10-28T10:00:00.000Z',
    endedAt: null,
    ...over,
  };
}

const sse = (event: CopilotEvent) => `data: ${JSON.stringify(event)}\n\n`;
const line = (id: string, name: string, text: string) => ({
  id,
  participant: 'p',
  name,
  text,
  at: 0,
  until: 0,
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pairux-copilot-'));
  out = [];
  err = [];
  calls = [];
  sleeps = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseMeetingRef', () => {
  it('accepts a session id, a join code and URLs carrying either', () => {
    expect(parseMeetingRef(SESSION.toUpperCase())).toEqual({ sessionId: SESSION });
    expect(parseMeetingRef('abc123')).toEqual({ joinCode: 'ABC123' });
    expect(parseMeetingRef('https://pairux.com/join/xyz789')).toEqual({ joinCode: 'XYZ789' });
    expect(parseMeetingRef(`https://pairux.com/session/${SESSION}?x=1`)).toEqual({
      sessionId: SESSION,
    });
    expect(parseMeetingRef('pairux://join/ABC123')).toEqual({ joinCode: 'ABC123' });
  });

  it('rejects anything else', () => {
    expect(parseMeetingRef('hello world')).toBeNull();
    expect(parseMeetingRef('ABC12')).toBeNull();
    expect(parseMeetingRef('https://pairux.com/pricing')).toBeNull();
    expect(parseMeetingRef('file:///etc/ABC123')).toBeNull();
  });
});

describe('readSseEvents', () => {
  it('reassembles events split across chunks and skips heartbeats and junk', async () => {
    const body = streamOf([
      ': copilot\n\n',
      'data: {"type":"notice",',
      '"message":"hi"}\r\n\r\n',
      'data: not json\n\n',
      'data: {"type":"notice","message":"tail"}',
    ]);
    const events: unknown[] = [];
    for await (const e of readSseEvents(body)) events.push(e);
    expect(events).toEqual([
      { type: 'notice', message: 'hi' },
      { type: 'notice', message: 'tail' },
    ]);
  });
});

describe('formatting', () => {
  it('prints notes with owners, question status and figures', () => {
    expect(
      formatNotes(
        state({
          notes: {
            summary: 'Pricing call.',
            keyPoints: ['Wants SSO'],
            decisions: [],
            actionItems: [{ text: 'Send quote', owner: 'Ana', due: 'Friday' }],
          },
          openQuestions: [
            { id: 'q1', text: 'Budget?', status: 'answered', answer: '$40k', at: 0 },
            { id: 'q2', text: 'Who signs?', status: 'open', at: 0 },
          ],
          figures: [{ id: 'f1', kind: 'money', value: '$40k', context: 'annual budget' }],
        }),
        'Acme call'
      )
    ).toEqual([
      'Acme call',
      'Summary: Pricing call.',
      'Key points:',
      '  - Wants SSO',
      'Action items:',
      '  - Send quote (Ana, due Friday)',
      'Questions:',
      '  [answered] Budget? -> $40k',
      '  [open] Who signs?',
      'Key figures:',
      '  money: $40k (annual budget)',
    ]);
  });

  it('says a thin call is too thin to review', () => {
    expect(
      formatReview({
        thin: true,
        focusArea: '',
        feedback: [],
        talkListen: { you: 0, others: 0 },
        questions: { asked: 0, answered: 0 },
        followUpClarity: 'unclear',
      })
    ).toEqual(['Review: too thin to review.']);
    expect(
      formatReview({
        thin: false,
        focusArea: 'Ask about budget earlier',
        feedback: ['Good recap at the end'],
        talkListen: { you: 0.42, others: 0.58 },
        questions: { asked: 5, answered: 3 },
        followUpClarity: 'clear',
      })
    ).toEqual([
      'Review:',
      '  Focus: Ask about budget earlier',
      '  Talk/listen: you 42%, others 58%',
      '  Questions: 5 asked, 3 answered',
      '  Follow-up clarity: clear',
      '  - Good recap at the end',
    ]);
  });

  it('lines up the history table', () => {
    const rows = formatList([
      {
        id: COPILOT,
        sessionId: SESSION,
        role: 'sales',
        mode: 'auto',
        status: 'ended',
        title: 'Acme',
        summary: '',
        startedAt: '2026-10-28T10:00:00.000Z',
        endedAt: null,
      },
    ]);
    expect(rows[0]).toMatch(/^STARTED\s+STATUS\s+ROLE\s+ID\s+TITLE$/);
    expect(rows[1]).toBe(`2026-10-28 10:00  ended   sales  ${COPILOT}  Acme`);
  });

  it('does not repeat lines or suggestions after a reconnect', () => {
    const printer = new WatchPrinter({ backlog: 10 });
    const s = state({
      transcript: [line('l1', 'Ana', 'Hi')],
      suggestions: [{ id: 's1', question: 'Budget?', reason: 'not asked', at: 0 }],
    });
    expect(printer.print({ type: 'state', state: s })).toEqual([
      '* Copilot live as Sales (mode: auto), 1 lines so far.',
      '* Providers: speech: whisper (free), notes: claude (own key)',
      'Ana: Hi',
      '? Budget? (why: not asked)',
    ]);
    expect(printer.print({ type: 'line', line: line('l2', 'Bo', 'Hello') })).toEqual(['Bo: Hello']);
    // Reconnected: the fresh state replays l1 and l2; only l3 is new.
    expect(
      printer.print({
        type: 'state',
        state: {
          ...s,
          transcript: [...s.transcript, line('l2', 'Bo', 'Hello'), line('l3', 'Ana', 'So')],
        },
      })
    ).toEqual(['Ana: So']);
  });
});

describe('pairux copilot', () => {
  it('needs a sign-in', async () => {
    expect(
      await run(
        ['copilot', 'list'],
        deps(() => ({ status: 500, body: {} }))
      )
    ).toBe(2);
    expect(err[0]).toContain('pairux login');
    expect(calls).toHaveLength(0);
  });

  it('prints help without signing in', async () => {
    expect(
      await run(
        ['copilot'],
        deps(() => ({ status: 500, body: {} }))
      )
    ).toBe(0);
    expect(out[0]).toContain('AI meeting copilot');
  });

  it('starts by join code: looks the code up, then starts with the token', async () => {
    await signIn();
    const d = deps((call) =>
      call.path === '/api/sessions/join/ABC123'
        ? { status: 200, body: { data: { id: SESSION, status: 'active' } } }
        : { status: 200, body: { data: state() } }
    );
    expect(await run(['copilot', 'start', 'abc123', '--role', 'sales'], d)).toBe(0);
    expect(calls[1]).toMatchObject({
      method: 'POST',
      path: `/api/sessions/${SESSION}/copilot`,
      auth: 'Bearer pux_at_x',
    });
    expect(JSON.parse(calls[1].body!)).toEqual({ role: 'sales' });
    expect(out[0]).toBe('Copilot listening in abc123 as Sales (mode: auto).');
    expect(out).toContain('Listens for:');
    expect(out).toContain('Providers: speech: whisper (free), notes: claude (own key)');
    expect(out.at(-1)).toBe('Run `pairux copilot watch abc123` to follow it live.');
  });

  it('rejects an unknown role locally', async () => {
    await signIn();
    expect(
      await run(
        ['copilot', 'start', SESSION, '--role', 'pirate'],
        deps(() => ({ status: 500, body: {} }))
      )
    ).toBe(2);
    expect(err[0]).toContain('--role must be one of');
    expect(calls).toHaveLength(0);
  });

  it('defaults the meeting to the joined agent session', async () => {
    await signIn({
      agent: { participantId: 'p', sessionId: SESSION, joinCode: 'ABC123', displayName: 'A' },
    });
    const d = deps(() => ({ status: 200, body: { data: { answer: '$40k a year.' } } }));
    expect(await run(['copilot', 'ask', 'What', 'was', 'the', 'budget?'], d)).toBe(0);
    expect(calls[0].path).toBe(`/api/sessions/${SESSION}/copilot/ask`);
    expect(JSON.parse(calls[0].body!)).toEqual({ question: 'What was the budget?' });
    expect(out).toEqual(['$40k a year.']);
  });

  it('stops and prints follow-ups and the review; --json prints the raw state', async () => {
    await signIn();
    const final = state({
      status: 'ended',
      followUps: { actionItems: [{ text: 'Send quote', owner: 'Ana' }], message: 'Thanks all.' },
      review: {
        thin: true,
        focusArea: '',
        feedback: [],
        talkListen: { you: 0, others: 0 },
        questions: { asked: 0, answered: 0 },
        followUpClarity: 'unclear',
      },
    });
    const d = deps(() => ({ status: 200, body: { data: final } }));
    expect(await run(['copilot', 'stop', SESSION], d)).toBe(0);
    expect(calls[0].method).toBe('DELETE');
    expect(out).toContain('  - Send quote (Ana)');
    expect(out).toContain('  Thanks all.');
    expect(out.at(-1)).toBe('Review: too thin to review.');
    out = [];
    expect(await run(['copilot', 'stop', SESSION, '--json'], d)).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ id: COPILOT, status: 'ended' });
  });

  it('reports a server refusal as a PairUX error', async () => {
    await signIn();
    const d = deps(() => ({
      status: 403,
      body: { error: 'The AI copilot is part of PairUX Pro.' },
    }));
    expect(await run(['copilot', 'start', SESSION], d)).toBe(1);
    expect(err).toEqual(['PairUX: The AI copilot is part of PairUX Pro.']);
  });

  it('watches, reconnects after a dropped stream, and exits on ended', async () => {
    await signIn();
    let streams = 0;
    const d = deps(() => {
      streams += 1;
      if (streams === 1) {
        return {
          sse: [
            sse({ type: 'state', state: state() }),
            ': copilot\n\n',
            sse({ type: 'line', line: line('l1', 'Ana', 'Our budget is 40k') }),
            sse({
              type: 'suggestion',
              suggestion: {
                id: 's1',
                question: 'Who approves it?',
                reason: 'no decision-maker',
                at: 0,
              },
            }),
          ],
        };
      }
      if (streams === 2) return { fail: 'fetch failed' };
      return {
        sse: [
          sse({
            type: 'state',
            state: state({ transcript: [line('l1', 'Ana', 'Our budget is 40k')] }),
          }),
          sse({ type: 'notice', message: 'Speech paused: no credit.' }),
          sse({ type: 'ended', state: state({ status: 'ended' }) }),
        ],
      };
    });
    expect(await run(['copilot', 'watch', SESSION], d)).toBe(0);
    expect(calls.every((c) => c.path === `/api/sessions/${SESSION}/copilot/stream`)).toBe(true);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([3000, 3000]);
    expect(out).toEqual([
      '* Copilot live as Sales (mode: auto), 0 lines so far.',
      '* Providers: speech: whisper (free), notes: claude (own key)',
      'Ana: Our budget is 40k',
      '? Who approves it? (why: no decision-maker)',
      '! Speech paused: no credit.',
      '* Copilot ended.',
      expect.stringContaining(`pairux copilot followups ${COPILOT}`),
    ]);
    expect(err[0]).toContain('stream closed; reconnecting in 3 s');
    expect(err[1]).toContain('fetch failed');
  });

  it('does not retry when the stream is refused', async () => {
    await signIn();
    const d = deps(() => ({
      status: 404,
      body: { error: 'No copilot is running for you in this meeting.' },
    }));
    expect(await run(['copilot', 'watch', SESSION], d)).toBe(1);
    expect(calls).toHaveLength(1);
    expect(err).toEqual(['PairUX: No copilot is running for you in this meeting.']);
  });

  it('notes by copilot id, falling back to the meeting when the id is a session', async () => {
    await signIn();
    const d = deps((call) => {
      if (call.path === `/api/copilot/${SESSION}`)
        return { status: 404, body: { error: 'Not found' } };
      if (call.path === '/api/copilot')
        return {
          status: 200,
          body: { data: { copilots: [{ id: COPILOT, sessionId: SESSION, status: 'ended' }] } },
        };
      return {
        status: 200,
        body: {
          data: {
            copilot: state({
              notes: { summary: 'Done.', keyPoints: [], decisions: [], actionItems: [] },
            }),
            title: 'Acme',
          },
        },
      };
    });
    expect(await run(['copilot', 'notes', SESSION], d)).toBe(0);
    expect(calls.map((c) => c.path)).toEqual([
      `/api/copilot/${SESSION}`,
      '/api/copilot',
      `/api/copilot/${COPILOT}`,
    ]);
    expect(out).toEqual(['Acme', 'Summary: Done.']);
  });

  it('rewrites the review for a copilot id', async () => {
    await signIn();
    const d = deps((call) =>
      call.method === 'GET'
        ? { status: 200, body: { data: { copilot: state(), title: null } } }
        : {
            status: 200,
            body: {
              data: {
                followUps: null,
                review: {
                  thin: false,
                  focusArea: 'Listen more',
                  feedback: [],
                  talkListen: { you: 0.7, others: 0.3 },
                  questions: { asked: 1, answered: 1 },
                  followUpClarity: 'partial',
                },
              },
            },
          }
    );
    expect(await run(['copilot', 'review', COPILOT], d)).toBe(0);
    expect(calls[1]).toMatchObject({ method: 'POST', path: `/api/copilot/${COPILOT}/review` });
    expect(out).toContain('  Talk/listen: you 70%, others 30%');
  });

  it('updates settings: sets one key, clears another, masks the result', async () => {
    await signIn();
    const view = {
      mode: 'byok',
      role: 'general',
      keys: {
        anthropic: { set: true, last4: 'wxyz' },
        openai: { set: false, last4: null },
        elevenlabs: { set: false, last4: null },
      },
    };
    const d = deps(() => ({ status: 200, body: { data: view } }), {
      readStdin: () => Promise.resolve('sk-ant-secret-wxyz\n'),
    });
    expect(
      await run(
        ['copilot', 'settings', '--mode', 'byok', '--anthropic-key', '-', '--clear-openai-key'],
        d
      )
    ).toBe(0);
    expect(calls[0].method).toBe('PUT');
    expect(JSON.parse(calls[0].body!)).toEqual({
      mode: 'byok',
      keys: { anthropic: 'sk-ant-secret-wxyz', openai: null },
    });
    expect(out).toEqual([
      'Saved.',
      'Mode: byok',
      'Role: general (General)',
      'Own keys:',
      '  anthropic: set (…wxyz)',
      '  openai: not set',
      '  elevenlabs: not set',
    ]);
    expect(out.join('\n')).not.toContain('secret');
  });

  it('refuses a key that is both set and cleared', async () => {
    await signIn();
    expect(
      await run(
        ['copilot', 'settings', '--openai-key', 'sk-x', '--clear-openai-key'],
        deps(() => ({ status: 500, body: {} }))
      )
    ).toBe(2);
    expect(calls).toHaveLength(0);
  });

  it('shows the wallet', async () => {
    await signIn();
    const d = deps(() => ({
      status: 200,
      body: {
        data: {
          balance: '$4.20',
          balanceMicros: 4_200_000,
          markup: 1.1,
          topups: [
            { id: 'copilot_credit_5', priceUsd: 5 },
            { id: 'copilot_credit_20', priceUsd: 20 },
          ],
          usage: [],
        },
      },
    }));
    expect(await run(['copilot', 'wallet'], d)).toBe(0);
    expect(out).toEqual([
      'Balance: $4.20',
      "Pay-as-you-go charges are the provider's cost + 10%.",
      'Top-ups: $5, $20',
      'No charges yet.',
    ]);
  });
});
