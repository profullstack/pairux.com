/** Languages a meeting participant can hear others in. Spoken translation is
 * limited to what ElevenLabs Flash v2.5 voices; text works for all of them.
 * Kept in step with LIVE_VOICE_LANGUAGES in @profullstack/live-translate. */
export const TRANSLATION_LANGUAGES = [
  ['en', 'English'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['pt', 'Português'],
  ['it', 'Italiano'],
  ['nl', 'Nederlands'],
  ['pl', 'Polski'],
  ['sv', 'Svenska'],
  ['da', 'Dansk'],
  ['no', 'Norsk'],
  ['fi', 'Suomi'],
  ['cs', 'Čeština'],
  ['sk', 'Slovenčina'],
  ['hu', 'Magyar'],
  ['ro', 'Română'],
  ['bg', 'Български'],
  ['hr', 'Hrvatski'],
  ['el', 'Ελληνικά'],
  ['tr', 'Türkçe'],
  ['ru', 'Русский'],
  ['uk', 'Українська'],
  ['ar', 'العربية'],
  ['hi', 'हिन्दी'],
  ['ta', 'தமிழ்'],
  ['id', 'Bahasa Indonesia'],
  ['ms', 'Bahasa Melayu'],
  ['fil', 'Filipino'],
  ['vi', 'Tiếng Việt'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['zh', '中文'],
] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number][0];
const CODES = new Set<string>(TRANSLATION_LANGUAGES.map(([code]) => code));
export const isTranslationLanguage = (code: string): code is TranslationLanguage => CODES.has(code);
export const languageName = (code: string): string =>
  TRANSLATION_LANGUAGES.find(([one]) => one === code)?.[1] ?? code;

/** The listener's default "hear in" language: the browser's, else English. */
export function defaultListenLanguage(preferred: readonly string[] = []): TranslationLanguage {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0] ?? '';
    const code = base === 'nb' || base === 'nn' ? 'no' : base === 'tl' ? 'fil' : base;
    if (isTranslationLanguage(code)) return code;
  }
  return 'en';
}
