import { desktopCapturer, screen } from 'electron';
import type { CaptureSource } from '@pairux/shared-types';

export async function getCaptureSources(types: ('screen' | 'window')[]): Promise<CaptureSource[]> {
  try {
    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });

    // Get display info for screen sources
    const displays = screen.getAllDisplays();

    return sources.map((source) => {
      const isScreen = source.id.startsWith('screen:');
      let displayId: string | undefined;

      if (isScreen) {
        // Find matching display
        const display = displays.find((d) => source.display_id === String(d.id));
        displayId = display?.id.toString();
      }

      return {
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        type: isScreen ? 'screen' : 'window',
        displayId,
      } satisfies CaptureSource;
    });
  } catch (error) {
    console.error('[Capture] Failed to get capture sources:', error);
    throw error;
  }
}
