import { useState, useCallback, useEffect } from 'react';
import { X, Copy, Check, Loader2, Link2, Monitor, Users, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getElectronAPI } from '@/lib/ipc';
import type { Session, SessionMode } from '@pairux/shared-types';
import { APP_URL } from '../../shared/config';
import { getDefaultAllowGuestControl, getDefaultSessionMode } from '@/lib/sessionDefaults';

interface CreateLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartSharing: (session: Session) => void;
}

export function CreateLinkModal({ isOpen, onClose, onStartSharing }: CreateLinkModalProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<SessionMode>(() => getDefaultSessionMode());

  const createSession = useCallback(async () => {
    setIsCreating(true);
    setError(null);

    try {
      const api = getElectronAPI();
      const result = await api.invoke('session:create', {
        allowGuestControl: getDefaultAllowGuestControl(),
        maxParticipants: mode === 'sfu' ? 10 : 5,
        mode,
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      setSession(result.session);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      setError(message);
    } finally {
      setIsCreating(false);
    }
  }, [mode]);

  // Don't auto-create session - let user select mode first
  // useEffect(() => {
  //   if (isOpen && !session && !isCreating) {
  //     void createSession();
  //   }
  // }, [isOpen, session, isCreating, createSession]);

  useEffect(() => {
    if (!isOpen) {
      setSession(null);
      setError(null);
      setCopied(false);
      setMode('p2p');
    }
  }, [isOpen]);

  const handleCopyLink = useCallback(async () => {
    if (!session) return;

    const joinUrl = `${APP_URL}/join/${session.join_code}`;
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, [session]);

  const handleStartSharing = useCallback(() => {
    if (session) {
      onStartSharing(session);
      onClose();
    }
  }, [session, onStartSharing, onClose]);

  if (!isOpen) return null;

  const joinUrl = session ? `${APP_URL}/join/${session.join_code}` : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-md border-border">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Link2 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-xl">Create Join Link</CardTitle>
                <CardDescription>Share this link with participants</CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
              <Button
                variant="link"
                className="ml-2 h-auto p-0 text-destructive"
                onClick={() => void createSession()}
              >
                Try again
              </Button>
            </div>
          )}

          {isCreating && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="mt-4 text-sm text-muted-foreground">Creating session...</p>
            </div>
          )}

          {!session && !isCreating && (
            <>
              {/* Mode Selection */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Connection Mode</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('p2p');
                    }}
                    className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                      mode === 'p2p'
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-muted-foreground/50'
                    }`}
                  >
                    <Zap
                      className={`h-6 w-6 ${mode === 'p2p' ? 'text-primary' : 'text-muted-foreground'}`}
                    />
                    <div className="text-center">
                      <p
                        className={`font-medium ${mode === 'p2p' ? 'text-foreground' : 'text-muted-foreground'}`}
                      >
                        Direct (P2P)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Best for 1-on-1, lower latency
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('sfu');
                    }}
                    className={`flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors ${
                      mode === 'sfu'
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-muted-foreground/50'
                    }`}
                  >
                    <Users
                      className={`h-6 w-6 ${mode === 'sfu' ? 'text-primary' : 'text-muted-foreground'}`}
                    />
                    <div className="text-center">
                      <p
                        className={`font-medium ${mode === 'sfu' ? 'text-foreground' : 'text-muted-foreground'}`}
                      >
                        Relay (SFU)
                      </p>
                      <p className="text-xs text-muted-foreground">Best for multiple viewers</p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={onClose} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={() => void createSession()} className="flex-1">
                  <Link2 className="mr-2 h-4 w-4" />
                  Create Link
                </Button>
              </div>
            </>
          )}

          {session && !isCreating && (
            <>
              <div className="rounded-lg bg-muted p-4 text-center">
                <p className="mb-2 text-sm text-muted-foreground">Join Code</p>
                <p className="font-mono text-3xl font-bold tracking-widest text-foreground">
                  {session.join_code}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Join URL</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-muted px-3 py-2 text-sm">
                    {joinUrl}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => void handleCopyLink()}
                    className="shrink-0"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-sm text-muted-foreground">
                  Share this link with others. They can join and wait for you to start sharing your
                  screen.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={onClose} className="flex-1">
                  Close
                </Button>
                <Button onClick={handleStartSharing} className="flex-1">
                  <Monitor className="mr-2 h-4 w-4" />
                  Start Sharing Now
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
