import { LiveVoice, RoomTranslators } from '@profullstack/live-translate';
import { ClaudeTranslator } from './translator';
import { SupabaseTranslationMeter } from './meter';

export interface TranslationRuntime {
  rooms: RoomTranslators;
  voice: LiveVoice;
  translator: ClaudeTranslator;
  meter: SupabaseTranslationMeter;
}

/** One per server process (route modules can be instantiated more than once). */
const KEY = Symbol.for('pairux.translation');
export function translationRuntime(): TranslationRuntime | null {
  if (!process.env.ELEVENLABS_API_KEY || process.env.PAIRUX_TRANSLATION === 'off') return null;
  const store = globalThis as unknown as Record<symbol, TranslationRuntime | undefined>;
  if (!store[KEY]) {
    const meter = new SupabaseTranslationMeter();
    const voice = new LiveVoice({
      apiKey: process.env.ELEVENLABS_API_KEY,
      tokenPrefix: 'pxt_',
      billing: meter,
      // A meeting speaker is ~180 s of Scribe a minute (2 s steps, 6 s windows).
      limits: {
        concurrentHearing: 24,
        concurrentVoices: 16,
        audioPerMinute: 400,
        serverAudioPerMinute: 6000,
        channelCharsPerMinute: 20_000,
        serverCharsPerMinute: 60_000,
      },
      dailyAudioSeconds: Number(process.env.PAIRUX_TRANSLATION_DAILY_AUDIO_SECONDS ?? 864_000),
      dailyChars: Number(process.env.PAIRUX_TRANSLATION_DAILY_CHARS ?? 2_000_000),
      userDailyAudioSeconds: 172_800,
      userDailyChars: 400_000,
    });
    const translator = new ClaudeTranslator();
    store[KEY] = {
      meter,
      voice,
      translator,
      rooms: new RoomTranslators({ voice, translator, billing: meter, maxRooms: 100 }),
    };
  }
  return store[KEY];
}
