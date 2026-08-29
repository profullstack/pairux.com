/**
 * The one place that answers "how big should captured video be?".
 *
 * The user's quality setting used to be applied in exactly one spot — an
 * `applyConstraints({ width: { ideal } })` on the capture track — and `ideal`
 * is a hint a source is free to ignore. Chromium's desktop capturer routinely
 * does: a 4K monitor keeps producing a 3840x2160 track no matter what the
 * setting says. Anything downstream that sized itself from the track's real
 * settings therefore worked in native resolution while the user believed they
 * had chosen 1080p, which on a 4K display is 4x the pixels per frame.
 */

/** Standard presets. */
export const CAPTURE_RESOLUTION: Record<string, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

export const DEFAULT_QUALITY = '1080p';

const SETTINGS_STORAGE_KEY = 'pairux-settings';

/** The user's chosen quality, or the default when unset or unreadable. */
export function readQualitySetting(): string {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!saved) return DEFAULT_QUALITY;
    const parsed = JSON.parse(saved) as { recording?: { defaultQuality?: string } };
    const quality = parsed.recording?.defaultQuality;
    if (quality && quality in CAPTURE_RESOLUTION) return quality;
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_QUALITY;
}

/** The pixel budget for the user's current quality setting. */
export function qualityResolution(quality = readQualitySetting()): {
  width: number;
  height: number;
} {
  return CAPTURE_RESOLUTION[quality] ?? CAPTURE_RESOLUTION[DEFAULT_QUALITY];
}

/**
 * Shrink `source` to fit inside `bound` without changing its aspect ratio.
 *
 * Only ever scales down: a source already within budget is returned untouched
 * rather than upscaled into extra work for no detail.
 *
 * Both axes are floored to an even number. Even is what 4:2:0 chroma
 * subsampling actually requires, and flooring is what keeps the result inside
 * the budget — rounding to the nearest multiple of 16, which is what the
 * capture presets claim to do, turns a 1080 bound into 1088 and quietly
 * overshoots the very limit being applied. The presets themselves are not
 * 16-aligned either (1080 is not a multiple of 16), so that rule was never
 * really in force.
 */
export function fitWithin(
  source: { width: number; height: number },
  bound: { width: number; height: number }
): { width: number; height: number } {
  const { width, height } = source;
  if (width <= 0 || height <= 0) return alignEven(bound);

  const scale = Math.min(bound.width / width, bound.height / height, 1);
  return alignEven({ width: width * scale, height: height * scale });
}

function alignEven({ width, height }: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(2, Math.floor(width / 2) * 2),
    height: Math.max(2, Math.floor(height / 2) * 2),
  };
}
