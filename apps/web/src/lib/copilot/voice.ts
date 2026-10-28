import { createHash } from 'node:crypto';
import {
  LiveVoice,
  SpeechError,
  decodeWav,
  quietSamples,
  reliableText,
  speakerTurns,
  type ScribeResult,
  type SpeakerTranscript,
  type TranslationMeter,
  type TranslationUsage,
} from '@profullstack/live-translate';
import type { CopilotAccounts } from './account';
import { chargeMicros, scribeCostMicros } from './pricing';
import {
  Cooldowns,
  endpoint,
  providerChain,
  stepLabel,
  type ProviderContext,
  type ProviderStep,
} from './providers';

/** Free default: a Whisper server with the OpenAI transcription API (speaches, whisper.cpp). */
const LOCAL_STT_URL = () => endpoint(process.env.COPILOT_STT_URL, 'http://127.0.0.1:8178/v1');
const LOCAL_STT_MODEL = () => process.env.COPILOT_STT_MODEL ?? 'Systran/faster-whisper-small';

/** Whisper's verbose_json names languages ("english"); Scribe and the rest of PairUX use codes. */
const WHISPER_LANGUAGES: Record<string, string> = {
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  dutch: 'nl',
  polish: 'pl',
  russian: 'ru',
  ukrainian: 'uk',
  turkish: 'tr',
  arabic: 'ar',
  hindi: 'hi',
  japanese: 'ja',
  korean: 'ko',
  chinese: 'zh',
  vietnamese: 'vi',
  indonesian: 'id',
  swedish: 'sv',
  thai: 'th',
  hebrew: 'he',
  greek: 'el',
  czech: 'cs',
  romanian: 'ro',
};
export function whisperLanguage(value: unknown): string {
  if (typeof value !== 'string') return '';
  const lower = value.toLowerCase();
  if (/^[a-z]{2,3}$/.test(lower)) return lower;
  return WHISPER_LANGUAGES[lower] ?? '';
}

interface WhisperWord {
  word?: string;
  text?: string;
  start: number;
  end: number;
}
interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  no_speech_prob?: number;
  words?: WhisperWord[];
}
export interface WhisperVerbose {
  language?: string;
  text?: string;
  words?: WhisperWord[];
  segments?: WhisperSegment[];
}

/**
 * An OpenAI-style verbose transcription as the Scribe shape speakerTurns reads.
 * Word timestamps when the server gives them; otherwise each segment's words
 * are spread evenly over the segment. Segments Whisper itself marks as
 * probably silent are dropped (its hallucinations live there).
 */
export function whisperToScribe(body: WhisperVerbose): ScribeResult {
  const words: NonNullable<ScribeResult['words']> = [];
  const push = (text: string, start: number, end: number) => {
    const clean = text.trim();
    if (clean) words.push({ text: clean, start, end, type: 'word', speaker_id: 'speaker_0' });
  };
  const segments = (body.segments ?? []).filter((one) => (one.no_speech_prob ?? 0) < 0.6);
  const flatWords = body.words ?? segments.flatMap((one) => one.words ?? []);
  if (flatWords.length) {
    for (const word of flatWords) push(word.word ?? word.text ?? '', word.start, word.end);
  } else {
    for (const segment of segments) {
      const parts = segment.text.trim().split(/\s+/).filter(Boolean);
      const step = (segment.end - segment.start) / Math.max(1, parts.length);
      parts.forEach((part, index) => {
        push(part, segment.start + index * step, segment.start + (index + 1) * step);
      });
    }
  }
  return { language_code: whisperLanguage(body.language), words };
}

/** POST a WAV to an OpenAI-compatible /audio/transcriptions endpoint. */
export async function whisperTranscribe(
  bytes: Uint8Array,
  options: {
    url: string;
    model: string;
    apiKey?: string | undefined;
    language?: string | undefined;
    signal?: AbortSignal | undefined;
    timeoutMs?: number | undefined;
    fetchImpl?: typeof fetch | undefined;
  }
): Promise<WhisperVerbose> {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'speech.wav');
  form.set('model', options.model);
  form.set('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('timestamp_granularities[]', 'segment');
  if (options.language && /^[a-z]{2,3}$/.test(options.language))
    form.set('language', options.language);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const response = await (options.fetchImpl ?? fetch)(`${options.url}/audio/transcriptions`, {
    method: 'POST',
    headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
    body: form,
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new SpeechError(
      `Transcription failed (${String(response.status)}) ${detail}`.trim(),
      503
    );
  }
  return (await response.json()) as WhisperVerbose;
}

/** Bills PAYG transcription on our ElevenLabs key to the copilot room's payer. */
class PaygSttMeter implements TranslationMeter {
  constructor(
    private readonly accounts: CopilotAccounts,
    private readonly ctx: () => ProviderContext
  ) {}
  async require(): Promise<void> {
    const { admin, userId } = this.ctx();
    if (admin) return;
    if ((await this.accounts.balanceMicros(userId)) <= 0)
      throw new SpeechError('Copilot credit is empty.', 402);
  }
  async reserve(_by: string, kind: TranslationUsage, units: number): Promise<string> {
    const { admin, userId, sessionId } = this.ctx();
    if (admin || kind !== 'transcription') return '';
    const cost = scribeCostMicros(units);
    const id = await this.accounts.charge({
      userId,
      sessionId,
      provider: 'elevenlabs',
      kind: 'transcription',
      units,
      costMicros: cost,
      chargeMicros: chargeMicros(cost),
    });
    if (!id) throw new SpeechError('Copilot credit is empty.', 402);
    return id;
  }
  async commit(): Promise<void> {
    /* charged at reserve */
  }
  async refund(id: string): Promise<void> {
    if (id) await this.accounts.refund(id);
  }
}

/** Own keys are never metered by us. */
const UNMETERED: TranslationMeter = {
  require: () => Promise.resolve(),
  reserve: () => Promise.resolve(''),
  commit: () => Promise.resolve(),
  refund: () => Promise.resolve(),
};

/**
 * The copilot room's speech-to-text, standing in for LiveVoice inside the
 * live-translate RoomTranslator (which only calls available() and hear()).
 * Tries providers in the owner's order and reports which one heard last.
 */
export class CopilotVoice {
  private readonly cooldowns = new Cooldowns();
  private readonly ownVoices = new Map<string, LiveVoice>();
  private readonly payg: PaygSttMeter;
  /** Label of the provider that last produced a transcript. */
  current = '';
  /** Why the last phrase could not be heard, for the owner's notice. */
  problem = '';

  constructor(
    private readonly accounts: CopilotAccounts,
    private readonly ctx: () => ProviderContext,
    private readonly ours: () => LiveVoice | null,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.payg = new PaygSttMeter(accounts, ctx);
  }

  available(): boolean {
    return this.steps().length > 0;
  }

  steps(): ProviderStep[] {
    const { mode, keys } = this.ctx();
    const own: ('elevenlabs' | 'openai')[] = [];
    if (keys.elevenlabs) own.push('elevenlabs');
    if (keys.openai) own.push('openai');
    return providerChain(mode, {
      local: Boolean(LOCAL_STT_URL()),
      own,
      ours: this.ours()?.available() ? 'elevenlabs' : null,
    });
  }

  private ownVoice(key: string): LiveVoice {
    const id = createHash('sha256').update(key).digest('hex');
    let voice = this.ownVoices.get(id);
    if (!voice) {
      voice = new LiveVoice({ apiKey: key, tokenPrefix: 'pxc_' });
      this.ownVoices.set(id, voice);
    }
    return voice;
  }

  async hear(
    bytes: Uint8Array,
    by: string,
    signal?: AbortSignal,
    _meter?: TranslationMeter,
    resource = '',
    language = ''
  ): Promise<SpeakerTranscript> {
    const wav = decodeWav(bytes);
    const seconds = wav.samples.length / wav.rate;
    if (quietSamples(wav.samples)) return { language: '', seconds, turns: [] };
    const ctx = this.ctx();
    const problems: string[] = [];
    for (const step of this.steps()) {
      const key = step.kind === 'local' ? 'local' : `${step.kind}:${step.provider}:${ctx.userId}`;
      if (this.cooldowns.down(key)) continue;
      try {
        let heard: SpeakerTranscript;
        let label: string;
        if (step.kind === 'local' || (step.kind === 'own' && step.provider === 'openai')) {
          const local = step.kind === 'local';
          const body = await whisperTranscribe(bytes, {
            url: local ? (LOCAL_STT_URL() ?? '') : 'https://api.openai.com/v1',
            model: local ? LOCAL_STT_MODEL() : 'whisper-1',
            apiKey: local ? process.env.COPILOT_STT_KEY : ctx.keys.openai,
            language,
            signal,
            timeoutMs: local ? 12_000 : 10_000,
            fetchImpl: this.fetchImpl,
          });
          const result = whisperToScribe(body);
          // Whisper loops ("thank you thank you thank you…") on noise: drop the window.
          if (!reliableText(body.text ?? '', seconds)) result.words = [];
          heard = speakerTurns(result, wav);
          label = stepLabel(step, local ? 'Whisper' : 'OpenAI Whisper');
        } else if (step.kind === 'own') {
          heard = await this.ownVoice(ctx.keys.elevenlabs ?? '').hear(
            bytes,
            by,
            signal,
            UNMETERED,
            resource,
            language
          );
          label = stepLabel(step, 'ElevenLabs Scribe');
        } else {
          const ours = this.ours();
          if (!ours) continue;
          if (!ctx.admin && (await this.accounts.balanceMicros(ctx.userId)) <= 0) {
            problems.push('Pay-as-you-go transcription needs copilot credit.');
            continue;
          }
          heard = await ours.hear(bytes, by, signal, this.payg, resource, language);
          label = stepLabel(step, 'ElevenLabs Scribe');
        }
        this.cooldowns.ok(key);
        this.current = label;
        this.problem = '';
        return heard;
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        problems.push(message);
        // A slow or dead local server is skipped for a minute; a bad key for ten.
        const status = (error as { status?: number }).status;
        this.cooldowns.fail(key, status === 401 || status === 403 ? 600_000 : 60_000);
        console.warn(
          JSON.stringify({
            event: 'copilot_stt_failed',
            step: key.split(':').slice(0, 2).join(':'),
            error: message.slice(0, 200),
          })
        );
      }
    }
    this.problem = problems[0] ?? 'No speech-to-text provider is available.';
    // Transient on purpose: the room keeps the participant and tries the next phrase.
    throw new SpeechError(this.problem, 503);
  }

  /** The copilot never speaks: RoomTranslator only calls this for translated voices. */
  stream(): Promise<Response> {
    return Promise.reject(new SpeechError('The copilot does not speak.', 400));
  }
}
