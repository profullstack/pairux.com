import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Link2, Loader2 } from 'lucide-react';
import { SourcePicker } from '@/components/capture/SourcePicker';
import { CapturePreview } from '@/components/capture/CapturePreview';
import { CreateLinkModal } from '@/components/CreateLinkModal';
import { getElectronAPI } from '@/lib/ipc';
import { useAuthStore } from '@/stores/auth';
import type { CaptureSource, Session } from '@pairux/shared-types';
import type { DisplayServer } from '../../preload/api';

export function HomePage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [selectedSource, setSelectedSource] = useState<CaptureSource | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayServer, setDisplayServer] = useState<DisplayServer>('x11');
  const [isWayland, setIsWayland] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showCreateLinkModal, setShowCreateLinkModal] = useState(false);
  const [preCreatedSession, setPreCreatedSession] = useState<Session | null>(null);

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
    // Prevent multiple concurrent capture attempts
    if (isCapturing) return;

    setSelectedSource(source);
    setError(null);
    setIsCapturing(true);

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
            width: { ideal: 1920, max: 3840 },
            height: { ideal: 1080, max: 2160 },
            frameRate: { ideal: 30, max: 60 },
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
              minWidth: 1280,
              maxWidth: 3840,
              minHeight: 720,
              maxHeight: 2160,
              minFrameRate: 15,
              maxFrameRate: 60,
            },
          },
        });
      }

      console.log('[Renderer] Capture started successfully');

      // Set content hint on video track for screen sharing optimization
      // 'detail' tells encoder to prioritize sharpness (good for text)
      const videoTrack = mediaStream.getVideoTracks()[0];
      videoTrack.contentHint = 'detail';

      setStream(mediaStream);
    } catch (err) {
      console.error('[Renderer] Failed to start capture:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Provide more user-friendly error messages
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setError('Screen capture was canceled or permission denied. Please try again.');
      } else {
        setError(`Failed to capture: ${message}`);
      }
      setSelectedSource(null);
    } finally {
      setIsCapturing(false);
    }
  };

  // Handle Wayland direct capture (bypasses source picker)
  const handleWaylandCapture = async () => {
    if (isCapturing) return;

    setError(null);
    setIsCapturing(true);

    try {
      if (stream) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
      }

      console.log('[Renderer] Starting Wayland capture with system picker');

      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });

      // Create a synthetic source from the stream
      const track = mediaStream.getVideoTracks()[0];

      // Set content hint for screen sharing optimization
      // 'detail' tells encoder to prioritize sharpness (good for text)
      track.contentHint = 'detail';
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
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setError('Screen capture was canceled or permission denied. Please try again.');
      } else {
        setError(`Failed to capture: ${message}`);
      }
    } finally {
      setIsCapturing(false);
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
    <div className="flex flex-1 flex-col p-6">
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
        <div className="relative">
          {/* Loading overlay */}
          {isCapturing && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  {isWayland ? 'Waiting for system screen picker...' : 'Starting capture...'}
                </p>
              </div>
            </div>
          )}

          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Select a screen or window to share</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setShowCreateLinkModal(true);
                }}
                disabled={isCapturing}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Link2 className="h-4 w-4" />
                Create Link
              </button>
              <button
                onClick={() => void navigate('/join')}
                disabled={isCapturing}
                className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
              >
                <Users className="h-4 w-4" />
                Join a Session
              </button>
            </div>
          </div>

          {isWayland && (
            <div className="mb-6 rounded-lg bg-muted p-4">
              <p className="mb-3 text-sm text-muted-foreground">
                You&apos;re using Wayland. Click below to open the system screen picker, or select a
                source from the list.
              </p>
              <button
                onClick={() => {
                  void handleWaylandCapture();
                }}
                disabled={isCapturing}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isCapturing ? (
                  <>
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Waiting...
                  </>
                ) : (
                  'Open System Screen Picker'
                )}
              </button>
            </div>
          )}

          <SourcePicker
            onSelect={(source) => {
              void handleSourceSelect(source);
            }}
          />
        </div>
      ) : (
        <CapturePreview
          stream={stream}
          source={selectedSource}
          onStop={handleStopCapture}
          currentUserId={user?.id}
          initialSession={preCreatedSession}
        />
      )}

      <CreateLinkModal
        isOpen={showCreateLinkModal}
        onClose={() => {
          setShowCreateLinkModal(false);
        }}
        onStartSharing={(session) => {
          setPreCreatedSession(session);
          setShowCreateLinkModal(false);
        }}
      />
    </div>
  );
}
