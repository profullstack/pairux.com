/**
 * Chapters: the marks on the scrub bar and the label beside the clock.
 *
 * The player accepts them from whoever renders it; it does not source them. For
 * a recorded live the eventual source is the host — a list typed once after the
 * stream, or derived from what happened during it — and until that exists the
 * player simply renders none. That is why every function here tolerates an
 * empty list as an ordinary case rather than a missing input.
 *
 * Everything is pure and duration-aware, because the two ways chapter data goes
 * wrong are both silent: marks that sit off the end of a bar the reader cannot
 * reach, and marks so close together they render as one smudge.
 */

export interface Chapter {
  /** Seconds from the start of the recording. */
  start: number;
  title: string;
}

export interface NormalizedChapter extends Chapter {
  /** Where this chapter gives way to the next, or the end of the recording. */
  end: number;
  /** 0–1 across the whole recording, for placing the mark. */
  position: number;
}

/**
 * Sort, clean and close the ranges.
 *
 * Drops anything that cannot be drawn: a non-finite or negative start, a start
 * past the end of the recording, a blank title, and the second of two chapters
 * claiming the same second. Returns [] when there is no duration yet, because a
 * mark cannot be placed on a bar of unknown length — the caller re-runs this
 * once metadata lands.
 */
export function normalizeChapters(
  chapters: readonly Chapter[] | null | undefined,
  duration: number
): NormalizedChapter[] {
  if (!chapters || chapters.length === 0) return [];
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const seen = new Set<number>();
  const cleaned = chapters
    .filter((chapter): chapter is Chapter => Boolean(chapter) && typeof chapter.title === 'string')
    .map((chapter) => ({ start: Math.floor(chapter.start), title: chapter.title.trim() }))
    .filter((chapter) => Number.isFinite(chapter.start) && chapter.start >= 0)
    .filter((chapter) => chapter.start < duration)
    .filter((chapter) => chapter.title !== '')
    .sort((a, b) => a.start - b.start)
    .filter((chapter) => {
      if (seen.has(chapter.start)) return false;
      seen.add(chapter.start);
      return true;
    });

  return cleaned.map((chapter, index) => ({
    ...chapter,
    end: cleaned[index + 1]?.start ?? duration,
    position: chapter.start / duration,
  }));
}

/**
 * Which chapter contains this moment.
 *
 * Before the first chapter's start there is no chapter — a recording whose
 * first mark is at 2:00 genuinely has two unlabelled minutes, and inventing an
 * "Intro" for it would be putting words in the host's mouth.
 */
export function activeChapter(
  chapters: readonly NormalizedChapter[],
  seconds: number
): NormalizedChapter | null {
  if (!Number.isFinite(seconds)) return null;
  let found: NormalizedChapter | null = null;
  for (const chapter of chapters) {
    if (chapter.start <= seconds) found = chapter;
    else break;
  }
  return found;
}
