import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { encodeWav } from '@profullstack/live-translate';
import { COPILOT_STRINGS_EN } from '@pairux/meeting-copilot/strings';
import type { TranscriptLine } from '@pairux/meeting-copilot/types';
import en from '../../../messages/en.json';
import { isThin, lastSeconds, mergeUpdate, placeholder, talkListen, THIN_WORDS } from './analysis';
import { openKey, sealKey, validKeyShape, type CopilotAccounts } from './account';
import { CopilotLlm, CopilotLlmError, boundSchema, extractJson } from './llm';
import { chargeMicros, claudeCostMicros, scribeCostMicros } from './pricing';
import { Cooldowns, providerChain, type ProviderContext } from './providers';
import type { UpdateOutput } from './prompts';
import { CopilotVoice, whisperLanguage, whisperToScribe } from './voice';

vi.mock('@/lib/supabase/service', () => ({ serviceClient: () => ({}) }));

const line = (
  id: string,
  participant: string,
  text: string,
  at: number,
  until: number
): TranscriptLine => ({
  id,
  participant,
  name: participant,
  text,
  at,
  until,
});

describe('pay as you go pricing', () => {
  it('charges provider cost plus 10%, rounded up', () => {
    expect(chargeMicros(1000)).toBe(1100);
    expect(chargeMicros(1)).toBe(2);
    expect(chargeMicros(0)).toBe(0);
  });
  it('prices Claude per million tokens', () => {
    // Opus 5.5: $4 in, $20 out per MTok -> 1M in + 1M out = $24.
    expect(claudeCostMicros('claude-opus-5-5', 1_000_000, 1_000_000)).toBe(24_000_000);
    expect(claudeCostMicros('claude-haiku-5-5', 1_000_000, 0)).toBe(100_000);
    // An unknown model is charged at the dearest price we use, never free.
    expect(claudeCostMicros('mystery', 1_000_000, 0)).toBe(4_000_000);
  });
  it('prices Scribe at $0.22 per hour of 16 kHz audio', () => {
    expect(scribeCostMicros(16_000 * 3600)).toBe(220_000);
    expect(scribeCostMicros(0)).toBe(0);
  });
});

describe('provider chains: free first, paid as fallback or override', () => {
  const options = { local: true, own: ['anthropic' as const], ours: 'anthropic' as const };
  it('auto tries the free model, then own key, then PAYG', () => {
    expect(providerChain('auto', options)).toEqual([
      { kind: 'local' },
      { kind: 'own', provider: 'anthropic' },
      { kind: 'ours', provider: 'anthropic' },
    ]);
  });
  it('free never reaches a paid provider', () => {
    expect(providerChain('free', options)).toEqual([{ kind: 'local' }]);
  });
  it('byok uses own keys then free models, never ours', () => {
    expect(providerChain('byok', options)).toEqual([
      { kind: 'own', provider: 'anthropic' },
      { kind: 'local' },
    ]);
  });
  it('cloud puts paid first and keeps the free model as fallback', () => {
    expect(providerChain('cloud', options)).toEqual([
      { kind: 'own', provider: 'anthropic' },
      { kind: 'ours', provider: 'anthropic' },
      { kind: 'local' },
    ]);
  });
});

describe('Cooldowns', () => {
  it('skips a failed provider until its time is up', () => {
    let now = 0;
    const cooldowns = new Cooldowns(() => now);
    cooldowns.fail('local', 1000);
    expect(cooldowns.down('local')).toBe(true);
    now = 1001;
    expect(cooldowns.down('local')).toBe(false);
  });
});

describe('Whisper output', () => {
  it('uses word timestamps when present', () => {
    const result = whisperToScribe({
      language: 'english',
      words: [
        { word: ' Hello', start: 0, end: 0.4 },
        { word: ' there.', start: 0.5, end: 0.9 },
      ],
    });
    expect(result.language_code).toBe('en');
    expect(result.words?.map((word) => word.text)).toEqual(['Hello', 'there.']);
  });
  it('spreads segment words and drops likely-silent segments', () => {
    const result = whisperToScribe({
      segments: [
        { start: 0, end: 2, text: ' one two' },
        { start: 2, end: 4, text: ' Thank you.', no_speech_prob: 0.9 },
      ],
    });
    expect(result.words).toEqual([
      { text: 'one', start: 0, end: 1, type: 'word', speaker_id: 'speaker_0' },
      { text: 'two', start: 1, end: 2, type: 'word', speaker_id: 'speaker_0' },
    ]);
  });
  it('maps language names to codes', () => {
    expect(whisperLanguage('German')).toBe('de');
    expect(whisperLanguage('fr')).toBe('fr');
    expect(whisperLanguage('klingon')).toBe('');
  });
});

describe('mergeUpdate', () => {
  const base = {
    openQuestions: [{ id: 'q1', text: 'Who approves?', status: 'open' as const, at: 1 }],
    figures: [{ id: 'f1', kind: 'money' as const, value: '$40k', context: 'budget' }],
    suggestions: [{ id: 's1', question: 'When is the review?', reason: '', at: 1 }],
  };
  const output = (patch: Partial<UpdateOutput>): UpdateOutput => ({
    notes: {
      summary: ' A  call. ',
      keyPoints: ['x', ''],
      decisions: [],
      actionItems: [{ text: 'Send deck', owner: '' }],
    },
    questions: [],
    figures: [],
    suggestion: { question: '', reason: '', lineId: '' },
    ...patch,
  });
  let n = 0;
  const id = () => `new${String(++n)}`;

  it('cleans notes and drops empty bullets and empty owners', () => {
    const merged = mergeUpdate(base, output({}), new Set(), id, 5);
    expect(merged.notes.summary).toBe('A call.');
    expect(merged.notes.keyPoints).toEqual(['x']);
    expect(merged.notes.actionItems).toEqual([{ text: 'Send deck' }]);
  });
  it('closes known questions, adds new ones, and never reopens', () => {
    const merged = mergeUpdate(
      base,
      output({
        questions: [
          { id: 'q1', text: 'Who approves?', status: 'answered', answer: 'Priya', lineId: '' },
          { id: '', text: 'Timeline?', status: 'open', answer: '', lineId: 'L9' },
          { id: '', text: 'who approves?', status: 'open', answer: '', lineId: '' },
        ],
      }),
      new Set(['L1']),
      id,
      5
    );
    expect(merged.openQuestions[0]).toMatchObject({
      id: 'q1',
      status: 'answered',
      answer: 'Priya',
    });
    expect(merged.openQuestions).toHaveLength(2);
    // An invented line id is dropped, not trusted.
    expect(merged.openQuestions[1]?.lineId).toBeUndefined();
  });
  it('dedupes figures and repeated suggestions', () => {
    const merged = mergeUpdate(
      base,
      output({
        figures: [
          { kind: 'money', value: '$40K', context: 'again', lineId: '' },
          { kind: 'date', value: 'March 3', context: 'finance review', lineId: 'L1' },
        ],
        suggestion: { question: 'when is the review?', reason: 'gap', lineId: '' },
      }),
      new Set(['L1']),
      id,
      5
    );
    expect(merged.figures.map((one) => one.value)).toEqual(['$40k', 'March 3']);
    expect(merged.figures[1]?.lineId).toBe('L1');
    expect(merged.suggestion).toBeNull();
  });
});

describe('guards for small self-hosted models', () => {
  const empty: UpdateOutput = {
    notes: { summary: '', keyPoints: [], decisions: [], actionItems: [] },
    questions: [],
    figures: [],
    suggestion: { question: '', reason: '', lineId: '' },
  };
  const fresh = { openQuestions: [], figures: [], suggestions: [] };
  const id = () => 'x';

  it('treats filler words as empty and names the owner plainly', () => {
    expect(placeholder('Not specified')).toBe('');
    expect(placeholder('Owner')).toBe('');
    expect(placeholder('Anthony (you)')).toBe('Anthony');
    expect(placeholder('You (Anthony)')).toBe('Anthony');
    expect(placeholder('Priya')).toBe('Priya');
  });
  it('drops a questionnaire posing as one suggestion', () => {
    const merged = mergeUpdate(
      fresh,
      {
        ...empty,
        suggestion: { question: 'What is it? Who owns it? When?', reason: '', lineId: '' },
      },
      new Set(),
      id,
      1
    );
    expect(merged.suggestion).toBeNull();
  });
  it('drops rambling items and invented answers to open questions', () => {
    const merged = mergeUpdate(
      fresh,
      {
        ...empty,
        notes: { ...empty.notes, keyPoints: ['short', 'x'.repeat(500)] },
        questions: [
          { id: '', text: 'Who signs?', status: 'open', answer: 'Probably finance', lineId: '' },
        ],
      },
      new Set(),
      id,
      1
    );
    expect(merged.notes.keyPoints).toEqual(['short']);
    expect(merged.openQuestions[0]?.answer).toBeUndefined();
  });
  it('bounds every free-text string and array for grammar-constrained decoding', () => {
    const bounded = boundSchema(
      z.toJSONSchema(z.object({ a: z.string(), k: z.enum(['x', 'y']), list: z.array(z.string()) })),
      { maxLength: 10, maxItems: 3 }
    ) as { properties: Record<string, Record<string, unknown>> };
    expect(bounded.properties.a?.maxLength).toBe(10);
    expect(bounded.properties.k?.maxLength).toBeUndefined();
    expect(bounded.properties.list?.maxItems).toBe(3);
    expect((bounded.properties.list?.items as Record<string, unknown>).maxLength).toBe(10);
  });
});

describe('talk/listen and thin transcripts', () => {
  it('measures the owner share by speaking time', () => {
    const lines = [line('1', 'me', 'hi', 0, 1000), line('2', 'them', 'hello', 1000, 4000)];
    expect(talkListen(lines, 'me')).toEqual({ you: 0.25, others: 0.75 });
    expect(talkListen([], 'me')).toEqual({ you: 0, others: 0 });
  });
  it('calls a short transcript thin', () => {
    expect(isThin([line('1', 'a', 'too short', 0, 1)])).toBe(true);
    expect(isThin([line('1', 'a', 'word '.repeat(THIN_WORDS), 0, 1)])).toBe(false);
  });
  it('recaps only the last seconds', () => {
    const lines = [line('1', 'a', 'old', 0, 1000), line('2', 'a', 'new', 50_000, 60_000)];
    expect(lastSeconds(lines, 30).map((one) => one.id)).toEqual(['2']);
  });
});

describe('BYOK key storage', () => {
  const key = randomBytes(32);
  it('round-trips and refuses a tampered ciphertext', () => {
    const sealed = sealKey('sk-ant-secret-value-1234', key);
    expect(sealed).not.toContain('secret');
    expect(openKey(sealed, key)).toBe('sk-ant-secret-value-1234');
    const [v, iv, tag, body] = sealed.split('.');
    const flipped = [v, iv, tag, `${(body ?? '').slice(0, -2)}AA`].join('.');
    expect(() => openKey(flipped, key)).toThrow();
    expect(() => openKey(sealed, randomBytes(32))).toThrow();
  });
  it('checks key shapes per provider', () => {
    expect(validKeyShape('anthropic', 'sk-ant-api03-abcdefghijklmnop')).toBe(true);
    expect(validKeyShape('anthropic', 'sk-proj-abcdefghijklmnopqrst')).toBe(false);
    expect(validKeyShape('openai', 'sk-proj-abcdefghijklmnopqrst')).toBe(true);
    expect(validKeyShape('elevenlabs', 'short')).toBe(false);
    expect(validKeyShape('elevenlabs', 'with space in it 12345678901')).toBe(false);
  });
});

describe('CopilotLlm', () => {
  const schema = z.object({ answer: z.string() });
  const ctx = (patch: Partial<ProviderContext> = {}): ProviderContext => ({
    userId: 'u1',
    sessionId: 's1',
    mode: 'auto',
    keys: {},
    admin: false,
    ...patch,
  });
  const accounts = (balance: number) =>
    ({
      balanceMicros: vi.fn(() => Promise.resolve(balance)),
      charge: vi.fn(),
    }) as unknown as CopilotAccounts;
  const reply = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  it('pulls JSON out of fenced replies', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson('no json')).toThrow();
  });

  it('answers from the free local model first', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(reply('{"answer":"local"}')));
    const llm = new CopilotLlm(accounts(0), fetchImpl as unknown as typeof fetch);
    const result = await llm.run(ctx(), { name: 't', system: 's', prompt: 'p', schema });
    expect(result.data.answer).toBe('local');
    expect(result.provider).toContain('free');
    expect(fetchImpl.mock.calls[0]?.[0]).toEqual(expect.stringContaining('11434'));
  });

  it('falls back to the owner key when the local model fails, and never charges for it', async () => {
    const wallet = accounts(0);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('down', { status: 502 }))
      .mockResolvedValueOnce(reply('{"answer":"own key"}'));
    const llm = new CopilotLlm(wallet, fetchImpl as unknown as typeof fetch);
    const result = await llm.run(ctx({ keys: { openai: 'sk-test-0000000000000000000' } }), {
      name: 't',
      system: 's',
      prompt: 'p',
      schema,
    });
    expect(result.data.answer).toBe('own key');
    expect(result.provider).toContain('your key');
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe('https://api.openai.com/v1/chat/completions');
    expect(wallet.charge).not.toHaveBeenCalled();
  });

  it('skips pay-as-you-go with an empty wallet and says why', async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    try {
      const fetchImpl = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response('down', { status: 502 }))
      );
      const llm = new CopilotLlm(accounts(0), fetchImpl as unknown as typeof fetch);
      const failure = await llm
        .run(ctx(), { name: 't', system: 's', prompt: 'p', schema })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(CopilotLlmError);
      expect((failure as CopilotLlmError).problems).toContain(
        'Pay-as-you-go AI needs copilot credit.'
      );
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it('rejects a reply in the wrong shape', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(reply('{"nope":1}')));
    const llm = new CopilotLlm(accounts(0), fetchImpl as unknown as typeof fetch);
    await expect(
      llm.run(ctx({ mode: 'free' }), { name: 't', system: 's', prompt: 'p', schema })
    ).rejects.toBeInstanceOf(CopilotLlmError);
  });
});

describe('CopilotVoice', () => {
  const ctx: ProviderContext = {
    userId: 'u1',
    sessionId: 's1',
    mode: 'free',
    keys: {},
    admin: false,
  };
  const tone = () => {
    const samples = new Float32Array(16_000 * 2);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin(i / 8);
    return encodeWav(samples);
  };

  it('returns nothing for silence without calling a provider', async () => {
    const fetchImpl = vi.fn();
    const voice = new CopilotVoice(
      {} as CopilotAccounts,
      () => ctx,
      () => null,
      fetchImpl as unknown as typeof fetch
    );
    const heard = await voice.hear(encodeWav(new Float32Array(16_000)), 'by');
    expect(heard.turns).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('transcribes with the local Whisper server', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            language: 'en',
            text: 'Hello there.',
            words: [
              { word: 'Hello', start: 0.1, end: 0.5 },
              { word: 'there.', start: 0.6, end: 1.0 },
            ],
          }),
          { status: 200 }
        )
      )
    );
    const voice = new CopilotVoice(
      {} as CopilotAccounts,
      () => ctx,
      () => null,
      fetchImpl as unknown as typeof fetch
    );
    const heard = await voice.hear(tone(), 'by');
    expect(heard.turns.map((turn) => turn.text).join(' ')).toContain('Hello');
    expect(voice.current).toContain('free');
    expect(fetchImpl.mock.calls[0]?.[0]).toEqual(expect.stringContaining('/audio/transcriptions'));
  });

  it('fails transiently (503) when every provider is down', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('down', { status: 500 }))
    );
    const voice = new CopilotVoice(
      {} as CopilotAccounts,
      () => ctx,
      () => null,
      fetchImpl as unknown as typeof fetch
    );
    await expect(voice.hear(tone(), 'by')).rejects.toMatchObject({ status: 503 });
  });
});

describe('strings', () => {
  it('en.json carries exactly the panel strings the package renders', () => {
    expect((en as Record<string, unknown>).copilot).toEqual(COPILOT_STRINGS_EN);
  });
});
