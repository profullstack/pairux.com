import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import { SpeechError, type TextTranslator } from '@profullstack/live-translate';
import { languageName } from './languages';

export const TRANSLATION_MODEL = process.env.PAIRUX_TRANSLATION_MODEL ?? 'claude-opus-5-5';
const output = z.object({ texts: z.array(z.string()) });

/** Direct pair translation (French to German stays French to German) for live
 * speech and chat. `from` may be "" or "auto": the model identifies it. */
export class ClaudeTranslator implements TextTranslator {
  private readonly cache = new Map<string, string>();
  constructor(private readonly client = new Anthropic()) {}

  async translate(
    texts: string[],
    from: string,
    to: string,
    options: { deadline?: number; signal?: AbortSignal } = {}
  ): Promise<{ texts: string[] }> {
    if (!texts.length) return { texts: [] };
    const key = (text: string) => `${from}|${to}|${text}`;
    const missing = [...new Set(texts.filter((text) => !this.cache.has(key(text))))];
    if (missing.length) {
      const source =
        from && from !== 'auto' ? languageName(from) : 'whatever language each line is in';
      const timeout = Math.max(1000, (options.deadline ?? Date.now() + 15_000) - Date.now());
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
              'Never add commentary, never merge or split lines: return exactly one output per input, in order. ' +
              'If a line is already in the target language, return it unchanged.',
            messages: [
              {
                role: 'user',
                content: `Translate from ${source} into ${languageName(to)} (${to}).\n\n${JSON.stringify({ texts: missing })}`,
              },
            ],
          },
          { timeout, signal: options.signal, maxRetries: 0 }
        );
      } catch (error) {
        if (error instanceof Anthropic.RateLimitError)
          throw new SpeechError('Translation is rate limited. Waiting for the next phrase.', 503);
        if (
          error instanceof Anthropic.APIConnectionError ||
          error instanceof Anthropic.InternalServerError
        )
          throw new SpeechError('Translation is temporarily unavailable.', 503);
        throw error;
      }
      if (response.stop_reason === 'refusal')
        throw new SpeechError('This phrase could not be translated.', 502);
      const parsed = response.parsed_output?.texts ?? [];
      if (parsed.length !== missing.length)
        throw new SpeechError('Translation omitted a phrase. Waiting for the next phrase.', 502);
      missing.forEach((text, index) => this.cache.set(key(text), parsed[index] ?? text));
      for (const oldest of this.cache.keys()) {
        if (this.cache.size <= 2000) break;
        this.cache.delete(oldest);
      }
    }
    return { texts: texts.map((text) => this.cache.get(key(text)) ?? text) };
  }
}
