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
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Loading session...</p>
        </div>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="p-6 flex flex-1 items-center justify-center">
        <div className="max-w-md rounded-lg border-border bg-card p-6 w-full border text-center">
          <div className="h-12 w-12 bg-destructive/10 mx-auto flex items-center justify-center rounded-full">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">Session Error</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => void navigate('/join')}
            className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
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
      <div className="gap-4 p-6 flex flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="gap-3 flex items-center">
            <Monitor className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">Viewing Session</h2>
              <p className="text-sm text-muted-foreground">
                Hosted by {host?.display_name ?? 'Unknown'}
              </p>
            </div>
          </div>

          <div className="gap-2 flex items-center">
            {/* Chat toggle */}
            <button
              onClick={() => {
                setShowChat(!showChat);
              }}
              className={`gap-2 rounded-lg px-3 py-2 text-sm font-medium flex items-center transition-colors ${
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
              className="gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 flex items-center transition-colors disabled:opacity-50"
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
          <div className="rounded-lg bg-muted px-4 py-3 flex items-center justify-between">
            <div className="gap-4 flex items-center">
              <div className="gap-2 flex items-center">
                <span className="font-mono text-sm font-medium">{session.join_code}</span>
              </div>

              <div className="gap-1.5 text-sm text-muted-foreground flex items-center">
                <Users className="h-4 w-4" />
                {activeParticipants.length} participant
                {activeParticipants.length !== 1 ? 's' : ''}
              </div>
            </div>

            <span
              className={`px-2 py-0.5 text-xs font-medium rounded-full ${
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
        <div className="rounded-lg border-border bg-black relative flex-1 overflow-hidden border">
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Monitor className="h-16 w-16 text-muted-foreground/30 mx-auto" />
              <p className="mt-4 text-lg font-medium text-muted-foreground">
                Waiting for host to share screen...
              </p>
              <p className="mt-2 text-sm text-muted-foreground/70">
                The stream will appear here when ready
              </p>
            </div>
          </div>

          {/* Connection indicator */}
          <div className="left-4 top-4 gap-2 bg-black/70 px-3 py-1.5 absolute flex items-center rounded-full">
            <span className="h-2 w-2 animate-pulse bg-yellow-500 rounded-full" />
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
