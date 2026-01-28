import { useState, useEffect } from 'react';
import { TitleBar } from './components/layout/TitleBar';
import { SourcePicker } from './components/capture/SourcePicker';
import { CapturePreview } from './components/capture/CapturePreview';
import { getElectronAPI } from './lib/ipc';
import type { CaptureSource } from '@pairux/shared-types';
import type { DisplayServer } from '../preload/api';

function App() {
  const [selectedSource, setSelectedSource] = useState<CaptureSource | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayServer, setDisplayServer] = useState<DisplayServer>('x11');
  const [isWayland, setIsWayland] = useState(false);

  // Get platform info on mount
  useEffect(() => {
    const api = getElectronAPI();
    void api.invoke('platform:info', undefined).then((info) => {
      console.log('[Renderer] Platform info:', info);
      setDisplayServer(info.displayServer);
      setIsWayland(info.isWayland);
    });
  }, []);

  const handleSourceSelect = async (source: CaptureSource) => {
    setSelectedSource(source);
    setError(null);

    try {
      // Stop existing stream
      if (stream) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
      }

      console.log('[Renderer] Starting capture for source:', source.id);
      console.log('[Renderer] Display server:', displayServer);

      let mediaStream: MediaStream;

      if (isWayland) {
        // Wayland: Use getDisplayMedia with PipeWire portal
        // This will show the system's screen picker dialog
        console.log('[Renderer] Using getDisplayMedia for Wayland');
        mediaStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: source.type === 'screen' ? 'monitor' : 'window',
          },
          audio: false,
        });
      } else {
        // X11/Windows/macOS: Use getUserMedia with chromeMediaSource
        console.log('[Renderer] Using getUserMedia with chromeMediaSource');
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // @ts-expect-error Electron-specific constraint
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.id,
            },
          },
        });
      }

      console.log('[Renderer] Capture started successfully');
      setStream(mediaStream);
    } catch (err) {
      console.error('[Renderer] Failed to start capture:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to capture: ${message}`);
      setSelectedSource(null);
    }
  };

  // Handle Wayland direct capture (bypasses source picker)
  const handleWaylandCapture = async () => {
    setError(null);

    try {
      if (stream) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
      }

      console.log('[Renderer] Starting Wayland capture with system picker');

      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      // Create a synthetic source from the stream
      const track = mediaStream.getVideoTracks()[0];
      const settings = track.getSettings();

      setSelectedSource({
        id: track.id,
        name: track.label || 'Screen',
        type: 'screen',
        thumbnail: undefined,
      });

      console.log('[Renderer] Wayland capture started:', settings);
      setStream(mediaStream);
    } catch (err) {
      console.error('[Renderer] Failed to start Wayland capture:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to capture: ${message}`);
    }
  };

  const handleStopCapture = () => {
    if (stream) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      setStream(null);
      setSelectedSource(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TitleBar />
      <main className="flex flex-1 flex-col p-6">
        {error && (
          <div className="mb-4 rounded-lg bg-destructive/10 p-4 text-destructive">
            {error}
            <button
              onClick={() => {
                setError(null);
              }}
              className="ml-4 text-sm underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {!stream ? (
          <>
            <h1 className="mb-6 text-2xl font-semibold">Select a screen or window to share</h1>

            {isWayland && (
              <div className="mb-6 rounded-lg bg-muted p-4">
                <p className="mb-3 text-sm text-muted-foreground">
                  You&apos;re using Wayland. Click below to open the system screen picker, or select
                  a source from the list.
                </p>
                <button
                  onClick={() => {
                    void handleWaylandCapture();
                  }}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Open System Screen Picker
                </button>
              </div>
            )}

            <SourcePicker
              onSelect={(source) => {
                void handleSourceSelect(source);
              }}
            />
          </>
        ) : (
          <CapturePreview stream={stream} source={selectedSource} onStop={handleStopCapture} />
        )}
      </main>
    </div>
  );
}

export default App;
