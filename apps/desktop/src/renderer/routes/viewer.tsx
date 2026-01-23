import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Monitor, Users, Loader2, LogOut, MessageSquare, AlertCircle } from 'lucide-react';
import { ChatPanel } from '@/components/chat';
import { useAuthStore } from '@/stores/auth';
import { getElectronAPI } from '@/lib/ipc';
import type { Session, SessionParticipant } from '@pairux/shared-types';

export function ViewerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showChat, setShowChat] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      void navigate('/join');
      return;
    }

    const loadSession = async () => {
      try {
        const api = getElectronAPI();
        const result = await api.invoke('session:get', { sessionId });

        if (!result.success) {
          setError(result.error);
          return;
        }

        setSession(result.session);
        setParticipants(result.participants);
      } catch {
        setError('Failed to load session');
      } finally {
        setLoading(false);
      }
    };

    void loadSession();

    // Poll for updates every 5 seconds
    const interval = setInterval(() => {
      void loadSession();
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [sessionId, navigate]);

  const handleLeave = () => {
    setLeaving(true);
    // Navigate back to join page
    void navigate('/join');
  };

  const activeParticipants = participants.filter((p) => !p.left_at);
  const host = participants.find((p) => p.role === 'host');

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Loading session...</p>
        </div>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">Session Error</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => void navigate('/join')}
            className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1">
      {/* Main content */}
      <div className="flex flex-1 flex-col gap-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">Viewing Session</h2>
              <p className="text-sm text-muted-foreground">
                Hosted by {host?.display_name ?? 'Unknown'}
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

            {/* Leave button */}
            <button
              onClick={handleLeave}
              disabled={leaving}
              className="flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
            >
              {leaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              Leave Session
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
        {session && (
          <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">{session.join_code}</span>
              </div>

              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                {activeParticipants.length} participant
                {activeParticipants.length !== 1 ? 's' : ''}
              </div>
            </div>

            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                session.status === 'active'
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-yellow-500/10 text-yellow-500'
              }`}
            >
              {session.status.toUpperCase()}
            </span>
          </div>
        )}

        {/* Video viewer placeholder */}
        <div className="relative flex-1 overflow-hidden rounded-lg border border-border bg-black">
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Monitor className="mx-auto h-16 w-16 text-muted-foreground/30" />
              <p className="mt-4 text-lg font-medium text-muted-foreground">
                Waiting for host to share screen...
              </p>
              <p className="mt-2 text-sm text-muted-foreground/70">
                The stream will appear here when ready
              </p>
            </div>
          </div>

          {/* Connection indicator */}
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
            <span className="text-xs font-medium text-white">CONNECTING</span>
          </div>
        </div>
      </div>

      {/* Chat panel */}
      {session && showChat && (
        <ChatPanel
          sessionId={session.id}
          currentUserId={user?.id}
          isCollapsed={!showChat}
          onToggleCollapse={() => {
            setShowChat(!showChat);
          }}
        />
      )}
    </div>
  );
}
