import { describe, expect, it, vi } from 'vitest';
import { createProvider } from './factory.js';
import {
  createAnthropicProvider,
  type AnthropicClientLike,
  type AnthropicCreateBody,
  type AnthropicMessageResponse,
} from './anthropic.js';
import { createOllamaProvider, type FetchLike, type FetchResponseLike } from './ollama.js';
import type { TranscriptInput } from '../types.js';

const input: TranscriptInput = {
  segments: [{ startMs: 0, endMs: 3000, speaker: 'Host', text: 'ship it' }],
};

const NOTE_JSON = JSON.stringify({
  tldr: 'ship it',
  decisions: [],
  actionItems: [],
  topics: ['release'],
});

const CLIPS_JSON = JSON.stringify([
  { startMs: 0, endMs: 3000, title: 'Ship it', hookCaption: 'We shipped', platformFit: ['shorts'] },
]);

function fakeAnthropic(replies: string[]): { client: AnthropicClientLike; bodies: AnthropicCreateBody[] } {
  const bodies: AnthropicCreateBody[] = [];
  let call = 0;
  const client: AnthropicClientLike = {
    messages: {
      create(body: AnthropicCreateBody): Promise<AnthropicMessageResponse> {
        bodies.push(body);
        const text = replies[call] ?? replies[replies.length - 1] ?? '';
        call += 1;
        return Promise.resolve({ content: [{ type: 'text', text }] });
      },
    },
  };
  return { client, bodies };
}

describe('anthropic provider', () => {
  it('defaults to the Haiku model (finding F3)', () => {
    const { client } = fakeAnthropic([NOTE_JSON]);
    expect(createAnthropicProvider({ client }).model).toBe('claude-haiku-4-5');
  });

  it('summarizes and sends only transcript text', async () => {
    const { client, bodies } = fakeAnthropic([NOTE_JSON]);
    const note = await createAnthropicProvider({ client, model: 'claude-sonnet-5' }).summarizeSession(input);
    expect(note.topics).toEqual(['release']);
    expect(bodies[0]?.model).toBe('claude-sonnet-5');
    expect(bodies[0]?.messages[0]?.content).toContain('ship it');
  });

  it('selects clips and validates them', async () => {
    const { client } = fakeAnthropic([CLIPS_JSON]);
    const clips = await createAnthropicProvider({ client }).selectClips(input, { maxClips: 1 });
    expect(clips).toHaveLength(1);
    expect(clips[0]?.title).toBe('Ship it');
  });

  it('repairs one malformed reply before succeeding', async () => {
    const { client, bodies } = fakeAnthropic(['not json at all', NOTE_JSON]);
    const note = await createAnthropicProvider({ client }).summarizeSession(input);
    expect(note.tldr).toBe('ship it');
    expect(bodies).toHaveLength(2);
  });
});

function fakeFetch(content: string): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = (url) => {
    urls.push(url);
    const response: FetchResponseLike = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ message: { content } }),
    };
    return Promise.resolve(response);
  };
  return { fetchImpl, urls };
}

describe('ollama provider', () => {
  it('posts to /api/chat and parses the reply', async () => {
    const { fetchImpl, urls } = fakeFetch(NOTE_JSON);
    const note = await createOllamaProvider({ fetchImpl, baseUrl: 'http://localhost:11434/' }).summarizeSession(input);
    expect(note.topics).toEqual(['release']);
    expect(urls[0]).toBe('http://localhost:11434/api/chat');
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({ ok: false, status: 500, statusText: 'Server Error', json: () => Promise.resolve({}) });
    await expect(createOllamaProvider({ fetchImpl }).summarizeSession(input)).rejects.toThrow('Ollama request failed');
  });
});

describe('createProvider', () => {
  it('builds an anthropic provider', () => {
    const { client } = fakeAnthropic([NOTE_JSON]);
    expect(createProvider({ kind: 'anthropic', client }).kind).toBe('anthropic');
  });

  it('builds an ollama provider', () => {
    expect(createProvider({ kind: 'ollama', fetchImpl: vi.fn() }).kind).toBe('ollama');
  });
});
