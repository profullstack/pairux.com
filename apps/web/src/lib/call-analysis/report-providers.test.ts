import { describe, expect, it, vi } from 'vitest';
import {
  ReportQuotaError,
  reportProviders,
  strictJsonSchema,
  writeReport,
  writeReportWithOpenAI,
  type CallReport,
  type ReportInput,
} from './report';

const input: ReportInput = {
  kind: 'interview',
  title: 'Test',
  hostName: 'Anthony',
  source: 'web',
  segments: [{ startMs: 0, endMs: 5000, speaker: 'A', text: 'Tell me about yourself?' }],
  metrics: {
    durationMs: 5000,
    talkMs: 5000,
    silenceShare: 0,
    speakers: [],
    topFillers: [],
  },
  frames: [],
};

const report: CallReport = {
  headline: 'Solid',
  overallScore: 7,
  summary: 's',
  speakers: [{ label: 'A', role: 'host' }],
  strengths: [],
  improvements: [],
  delivery: { pace: 'p', clarity: 'c', confidence: 'c', fillerWords: 'f', listening: 'l' },
  visuals: null,
  focus: { title: 'Question by question', points: [] },
  keyMoments: [],
  actionItems: [],
  practiceNext: ['x'],
};

function openaiResponse(status: number, body: unknown): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as never;
}

describe('provider order', () => {
  it('defaults to Claude then OpenAI and honours REPORT_PROVIDERS', () => {
    expect(reportProviders({})).toEqual(['anthropic', 'openai']);
    expect(reportProviders({ REPORT_PROVIDERS: 'openai, anthropic' })).toEqual([
      'openai',
      'anthropic',
    ]);
    expect(reportProviders({ REPORT_PROVIDERS: 'openai,bogus,openai' })).toEqual(['openai']);
    expect(reportProviders({ REPORT_PROVIDERS: 'nonsense' })).toEqual(['anthropic', 'openai']);
  });
});

describe('writeReport fallback', () => {
  it('uses OpenAI when Claude is out of budget', async () => {
    const openai = vi.fn(() => Promise.resolve({ report, model: 'gpt-5.4' }));
    const result = await writeReport(input, {
      providers: ['anthropic', 'openai'],
      anthropic: () =>
        writeReportWithOpenAI(input, {
          apiKey: 'k',
          fetchImpl: openaiResponse(429, {
            error: { message: 'You exceeded your current quota', code: 'insufficient_quota' },
          }),
        }),
      openai,
    });
    expect(result.model).toBe('gpt-5.4');
    expect(openai).toHaveBeenCalledOnce();
  });

  it('asks the job to wait when every provider is out of budget', async () => {
    const quota = () =>
      writeReportWithOpenAI(input, {
        apiKey: 'k',
        fetchImpl: openaiResponse(429, { error: { message: 'quota', code: 'insufficient_quota' } }),
      });
    await expect(
      writeReport(input, { providers: ['anthropic', 'openai'], anthropic: quota, openai: quota })
    ).rejects.toBeInstanceOf(ReportQuotaError);
  });

  it('waits rather than fails when one is out of budget and the other is not configured', async () => {
    await expect(
      writeReport(input, {
        providers: ['anthropic', 'openai'],
        anthropic: () =>
          writeReportWithOpenAI(input, {
            apiKey: 'k',
            fetchImpl: openaiResponse(429, { error: { code: 'insufficient_quota' } }),
          }),
        openai: () => writeReportWithOpenAI(input, { apiKey: '' as never }),
      })
    ).rejects.toBeInstanceOf(ReportQuotaError);
  });

  it('does not fall back on a bad request that is not about budget', async () => {
    const openai = vi.fn();
    await expect(
      writeReport(input, {
        providers: ['anthropic', 'openai'],
        anthropic: () =>
          writeReportWithOpenAI(input, {
            apiKey: 'k',
            fetchImpl: openaiResponse(400, { error: { message: 'bad schema' } }),
          }),
        openai,
      })
    ).rejects.toThrow(/bad schema/);
    expect(openai).not.toHaveBeenCalled();
  });
});

describe('OpenAI provider', () => {
  it('sends a strict JSON schema and validates the reply', async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string) as Record<string, unknown>;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'gpt-5.4-2026-03-05',
            choices: [{ message: { content: JSON.stringify({ ...report, overallScore: 11.6 }) } }],
          }),
          { status: 200 }
        )
      );
    }) as never;
    const out = await writeReportWithOpenAI(input, { apiKey: 'k', fetchImpl });
    expect(out.model).toBe('gpt-5.4-2026-03-05');
    expect(out.report.overallScore).toBe(10);
    const format = sent.response_format as { json_schema: { strict: boolean } };
    expect(format.json_schema.strict).toBe(true);
  });

  it('makes every object strict: all keys required, no extras', () => {
    const check = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.type === 'object' && obj.properties) {
        expect(obj.additionalProperties).toBe(false);
        expect(obj.required).toEqual(Object.keys(obj.properties as object));
      }
      Object.values(obj).forEach(check);
    };
    check(strictJsonSchema());
  });
});
