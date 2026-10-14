import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { SpeechError, type TextTranslator } from '@profullstack/live-translate';
import { languageName } from './languages';

export const TRANSLATION_MODEL = process.env.PAIRUX_TRANSLATION_MODEL ?? 'claude-opus-5-5';
const output = z.object({
  results: z.array(z.object({ to: z.string(), texts: z.array(z.string()) })),
});
/** Requests arriving this close together share one model call. */
const COALESCE_MS = 120;

interface Ask {
  texts: string[];
  to: string;
  deadline: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * Direct pair translation (French to German stays French to German) for live
 * speech and chat. `from` may be "" or "auto": the model identifies it.
 *
 * In a meeting the same phrase is wanted in several languages at the same
 * moment (one target pipeline per listener language). Those asks are
 * coalesced into ONE call that returns every target, so a phrase costs one
 * request however many languages are listening; separate calls ran into the
 * API's rate limit on the third language.
 */
export class ClaudeTranslator implements TextTranslator {
  private readonly cache = new Map<string, string>();
  private readonly batches = new Map<
    string,
    { asks: Ask[]; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(private readonly client = new Anthropic()) {}

  private key(from: string, to: string, text: string): string {
    return `${from}|${to}|${text}`;
  }

  async translate(
    texts: string[],
    from: string,
    to: string,
    options: { deadline?: number; signal?: AbortSignal } = {}
  ): Promise<{ texts: string[] }> {
    if (!texts.length) return { texts: [] };
    const source = from && from !== 'auto' ? from : 'auto';
    const missing = [
      ...new Set(texts.filter((text) => !this.cache.has(this.key(source, to, text)))),
    ];
    if (missing.length) {
      await new Promise<void>((resolve, reject) => {
        const batch = this.batches.get(source) ?? {
          asks: [],
          timer: setTimeout(() => void this.flush(source), COALESCE_MS),
        };
        this.batches.set(source, batch);
        batch.asks.push({
          texts: missing,
          to,
          deadline: options.deadline ?? Date.now() + 15_000,
          resolve,
          reject,
        });
        options.signal?.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Translation was cancelled.', 'AbortError'));
          },
          { once: true }
        );
      });
    }
    return { texts: texts.map((text) => this.cache.get(this.key(source, to, text)) ?? text) };
  }

  private async flush(source: string): Promise<void> {
    const batch = this.batches.get(source);
    this.batches.delete(source);
    if (!batch) return;
    const texts = [...new Set(batch.asks.flatMap((ask) => ask.texts))];
    const targets = [...new Set(batch.asks.map((ask) => ask.to))];
    const deadline = Math.min(...batch.asks.map((ask) => ask.deadline));
    try {
      const results = await this.call(source, texts, targets, deadline);
      for (const to of targets) {
        const translated = results.get(to);
        if (translated?.length !== texts.length)
          throw new SpeechError('Translation omitted a phrase. Waiting for the next phrase.', 502);
        texts.forEach((text, index) =>
          this.cache.set(this.key(source, to, text), translated[index] ?? text)
        );
      }
      for (const oldest of this.cache.keys()) {
        if (this.cache.size <= 4000) break;
        this.cache.delete(oldest);
      }
      batch.asks.forEach((ask) => {
        ask.resolve();
      });
    } catch (error) {
      batch.asks.forEach((ask) => {
        ask.reject(error);
      });
    }
  }

  private async call(
    source: string,
    texts: string[],
    targets: string[],
    deadline: number
  ): Promise<Map<string, string[]>> {
    const from = source === 'auto' ? 'whatever language each line is in' : languageName(source);
    const into = targets.map((to) => `${languageName(to)} (${to})`).join(', ');
    let response;
    try {
      response = await this.client.beta.messages.parse(
        {
          model: TRANSLATION_MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low', format: betaZodOutputFormat(output) },
          system:
            'You are a live interpreter in a video meeting. Translate each input line faithfully and naturally, ' +
            'as a native speaker would say it aloud. Keep names, product names, numbers and code unchanged. ' +
            'Never add commentary, never merge or split lines: for every target language return exactly one ' +
            'output per input line, in order. If a line is already in a target language, return it unchanged for that target.',
          messages: [
            {
              role: 'user',
              content: `Translate from ${from} into each of: ${into}. Return one result per target language code.\n\n${JSON.stringify({ texts })}`,
            },
          ],
        },
        // Rate limits are retried by the SDK (it honours retry-after) inside the phrase's deadline.
        { timeout: Math.max(1500, deadline - Date.now()), maxRetries: 2 }
      );
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError)
        throw new SpeechError('Translation is rate limited. Waiting for the next phrase.', 503);
      if (
        error instanceof Anthropic.APIConnectionError ||
        error instanceof Anthropic.InternalServerError
      ) {
        throw new SpeechError('Translation is temporarily unavailable.', 503);
      }
      throw error;
    }
    if (response.stop_reason === 'refusal')
      throw new SpeechError('This phrase could not be translated.', 502);
    return new Map(
      (response.parsed_output?.results ?? []).map((result) => [result.to, result.texts])
    );
  }
}
