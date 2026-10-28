import { describe, expect, it } from 'vitest';
import { applyCopilotEvent, readSseEvents } from './events.js';
import { copilotTranslator } from './strings.js';
import { emptyNotes, type CopilotState } from './types.js';

const state = (): CopilotState => ({
  id: 'c1',
  sessionId: 's1',
  role: 'sales',
  mode: 'auto',
  status: 'live',
  notes: emptyNotes(),
  suggestions: [],
  openQuestions: [],
  figures: [],
  transcript: [],
  followUps: null,
  review: null,
  providers: {},
  notice: '',
  startedAt: '2026-10-28T00:00:00Z',
  endedAt: null,
});

describe('applyCopilotEvent', () => {
  it('appends lines once and keeps suggestions unique', () => {
    const line = { id: 'l1', participant: 'p', name: 'Maya', text: 'Hi', at: 0, until: 1 };
    let next = applyCopilotEvent(state(), { type: 'line', line });
    next = applyCopilotEvent(next, { type: 'line', line });
    expect(next?.transcript).toHaveLength(1);
    const suggestion = { id: 'q', question: 'Who approves?', reason: '', at: 1 };
    next = applyCopilotEvent(next, { type: 'suggestion', suggestion });
    next = applyCopilotEvent(next, { type: 'suggestion', suggestion });
    expect(next?.suggestions).toHaveLength(1);
  });
  it('replaces the state on ended', () => {
    const ended = { ...state(), status: 'ended' as const };
    expect(applyCopilotEvent(state(), { type: 'ended', state: ended })?.status).toBe('ended');
  });
  it('ignores events before any state', () => {
    expect(applyCopilotEvent(null, { type: 'notice', message: 'x' })).toBeNull();
  });
});

describe('readSseEvents', () => {
  it('parses data events across chunk boundaries and skips comments', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      ': copilot\n\ndata: {"type":"no',
      'tice","message":"a"}\n\ndata: bad\n\ndata: {"n":2}\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const events: unknown[] = [];
    for await (const event of readSseEvents(body)) events.push(event);
    expect(events).toEqual([{ type: 'notice', message: 'a' }, { n: 2 }]);
  });
});

describe('copilotTranslator', () => {
  it('resolves dotted keys and fills placeholders', () => {
    const t = copilotTranslator();
    expect(t('roles.sales.label')).toBe('Sales');
    expect(t('talkListen', { you: 40 })).toBe('You talked 40% of the time');
    expect(t('missing.key')).toBe('missing.key');
  });
});
