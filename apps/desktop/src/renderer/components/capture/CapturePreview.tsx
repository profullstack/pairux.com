import { useEffect, useRef, useState, useCallback } from 'react';
import {
  StopCircle,
  Monitor,
  AppWindow,
  Share2,
  Copy,
  Check,
  Users,
  Loader2,
  MessageSquare,
} from 'lucide-react';
import type { CaptureSource } from '@pairux/shared-types';
import { ChatPanel } from '@/components/chat';
import { useSession } from '@/hooks/useSession';

interface CapturePreviewProps {
  stream: MediaStream;
  source: CaptureSource | null;
  onStop: () => void;
  currentUserId?: string;
}

export function CapturePreview({ stream, source, onStop, currentUserId }: CapturePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [copied, setCopied] = useState(false);
  const [showChat, setShowChat] = useState(true);

  const { session, participants, isCreating, isEnding, error, createSession, endSession } =
    useSession();

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
    }

    return () => {
      if (video) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  // Auto-create session when capture starts
  useEffect(() => {
    if (!session && !isCreating) {
      void createSession({ allowGuestControl: false, maxParticipants: 5 });
    }
  }, [session, isCreating, createSession]);

  const handleStop = useCallback(async () => {
    if (session) {
      await endSession();
    }
    onStop();
  }, [session, endSession, onStop]);

  const handleCopyLink = useCallback(async () => {
    if (!session) return;

    const joinUrl = `https://pairux.com/join/${session.join_code}`;
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, [session]);

  const isScreen = source?.type === 'screen';
  const activeParticipants = participants.filter((p) => !p.left_at);

  return (
    <div className="flex flex-1">
      {/* Main content */}
      <div className="flex flex-1 flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isScreen ? (
              <Monitor className="h-5 w-5 text-primary" />
            ) : (
              <AppWindow className="h-5 w-5 text-primary" />
            )}
            <div>
              <h2 className="text-lg font-semibold">{source?.name ?? 'Capturing'}</h2>
              <p className="text-sm text-muted-foreground">
                {isScreen ? 'Screen' : 'Window'} capture active
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Chat toggle */}
            <button
              onClick={() => {
                setShowChat(!showChat);
              }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                showChat
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              Chat
            </button>

            {/* Stop button */}
            <button
              onClick={() => void handleStop()}
              disabled={isEnding}
              className="flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
            >
              {isEnding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <StopCircle className="h-4 w-4" />
              )}
              Stop Sharing
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Session info bar */}
        {session ? (
          <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-primary" />
                <span className="font-mono text-sm font-medium">{session.join_code}</span>
              </div>

              <button
                onClick={() => void handleCopyLink()}
                className="flex items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-background/80"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-green-500" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy Link
                  </>
                )}
              </button>

              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                {activeParticipants.length} viewer{activeParticipants.length !== 1 ? 's' : ''}
              </div>
            </div>

            <span className="font-mono text-sm text-muted-foreground">
              {stream.getVideoTracks()[0]?.getSettings().width ?? 0} x{' '}
              {stream.getVideoTracks()[0]?.getSettings().height ?? 0}
            </span>
          </div>
        ) : isCreating ? (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating session...
          </div>
        ) : null}

        {/* Video preview */}
        <div className="relative flex-1 overflow-hidden rounded-lg border border-border bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-contain"
          />

          {/* Live indicator */}
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            <span className="text-xs font-medium text-white">{session ? 'LIVE' : 'PREVIEW'}</span>
          </div>
        </div>
      </div>

      {/* Chat panel */}
      {session && showChat && (
        <ChatPanel
          sessionId={session.id}
          currentUserId={currentUserId}
          isCollapsed={!showChat}
          onToggleCollapse={() => {
            setShowChat(!showChat);
          }}
        />
      )}
    </div>
  );
}
