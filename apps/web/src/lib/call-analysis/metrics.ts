/**
 * Delivery metrics measured straight from the transcript. These are counted,
 * not judged: the report shows them as numbers next to Claude's feedback, so
 * "you talked 72% of the interview" is a fact the host can check, not an
 * impression.
 */

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  /** Diarized label, e.g. "A". Null when the transcript has no speakers. */
  speaker: string | null;
  text: string;
}

export interface SpeakerMetrics {
  speaker: string;
  talkMs: number;
  /** Share of all talk time, 0-100, rounded. */
  talkShare: number;
  words: number;
  wordsPerMinute: number;
  fillerWords: number;
  /** Filler words per 100 words spoken. */
  fillerRate: number;
  questions: number;
  longestTurnMs: number;
  turns: number;
  /** Turns this speaker started before the previous speaker had finished. */
  interruptions: number;
}

export interface CallMetrics {
  durationMs: number;
  talkMs: number;
  /** Share of the call where nobody was speaking, 0-100. */
  silenceShare: number;
  speakers: SpeakerMetrics[];
  topFillers: { word: string; count: number }[];
}

// Multi-word fillers first so "you know" is not also counted as two words.
const FILLERS = [
  'you know',
  'i mean',
  'sort of',
  'kind of',
  'um',
  'uh',
  'erm',
  'hmm',
  'like',
  'basically',
  'actually',
  'literally',
  'right',
  'so yeah',
];

const WORD = /[\p{L}\p{N}'’]+/gu;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

/** Filler words in one piece of text, by filler. "like" only as a standalone. */
export function countFillers(text: string): Map<string, number> {
  let rest = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}'’ ]+/gu, ' ')} `;
  const counts = new Map<string, number>();
  for (const filler of FILLERS) {
    const pattern = new RegExp(` ${filler.replace(/ /g, ' +')}(?= )`, 'g');
    const matches = rest.match(pattern);
    if (!matches) continue;
    counts.set(filler, matches.length);
    rest = rest.replace(pattern, ' ');
  }
  return counts;
}

/** Merge consecutive segments by the same speaker into turns. */
function toTurns(segments: TranscriptSegment[]): TranscriptSegment[] {
  const turns: TranscriptSegment[] = [];
  for (const seg of segments) {
    const last = turns.at(-1);
    if (last?.speaker === seg.speaker && seg.startMs - last.endMs < 1500) {
      last.endMs = Math.max(last.endMs, seg.endMs);
      last.text = `${last.text} ${seg.text}`;
    } else {
      turns.push({ ...seg });
    }
  }
  return turns;
}

export function computeMetrics(segments: TranscriptSegment[], durationMs: number): CallMetrics {
  const ordered = [...segments]
    .filter((s) => s.text.trim() && s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const turns = toTurns(ordered);

  const bySpeaker = new Map<string, SpeakerMetrics>();
  const fillerTotals = new Map<string, number>();
  const get = (speaker: string) => {
    let m = bySpeaker.get(speaker);
    if (!m) {
      m = {
        speaker,
        talkMs: 0,
        talkShare: 0,
        words: 0,
        wordsPerMinute: 0,
        fillerWords: 0,
        fillerRate: 0,
        questions: 0,
        longestTurnMs: 0,
        turns: 0,
        interruptions: 0,
      };
      bySpeaker.set(speaker, m);
    }
    return m;
  };

  for (const seg of ordered) {
    const m = get(seg.speaker ?? 'Speaker');
    m.talkMs += seg.endMs - seg.startMs;
    m.words += countWords(seg.text);
    m.questions += (seg.text.match(/\?/g) ?? []).length;
    for (const [word, n] of countFillers(seg.text)) {
      m.fillerWords += n;
      fillerTotals.set(word, (fillerTotals.get(word) ?? 0) + n);
    }
  }

  turns.forEach((turn, i) => {
    const m = get(turn.speaker ?? 'Speaker');
    m.turns += 1;
    m.longestTurnMs = Math.max(m.longestTurnMs, turn.endMs - turn.startMs);
    const prev = turns[i - 1];
    if (prev && prev.speaker !== turn.speaker && turn.startMs < prev.endMs - 300) {
      m.interruptions += 1;
    }
  });

  const talkMs = [...bySpeaker.values()].reduce((sum, m) => sum + m.talkMs, 0);
  for (const m of bySpeaker.values()) {
    m.talkShare = talkMs > 0 ? Math.round((m.talkMs / talkMs) * 100) : 0;
    m.wordsPerMinute = m.talkMs > 0 ? Math.round(m.words / (m.talkMs / 60_000)) : 0;
    m.fillerRate = m.words > 0 ? Math.round((m.fillerWords / m.words) * 1000) / 10 : 0;
  }

  // Speech time can exceed wall time when people talk over each other.
  const spoken = Math.min(talkMs, durationMs);
  return {
    durationMs,
    talkMs,
    silenceShare: durationMs > 0 ? Math.round(((durationMs - spoken) / durationMs) * 100) : 0,
    speakers: [...bySpeaker.values()].sort((a, b) => b.talkMs - a.talkMs),
    topFillers: [...fillerTotals.entries()]
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return `${h > 0 ? `${String(h)}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
