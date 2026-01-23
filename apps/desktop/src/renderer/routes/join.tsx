import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Monitor, User, Loader2, AlertCircle, Users, ArrowLeft } from 'lucide-react';

/**
 * Parse a join code from user input. Handles both raw codes and full URLs.
 * Examples:
 *   "ABC123" -> "ABC123"
 *   "https://pairux.com/join/abc123" -> "ABC123"
 *   "pairux.com/join/XYZ789" -> "XYZ789"
 */
function parseJoinInput(input: string): string {
  const trimmed = input.trim();
  // Try to extract code from URL pattern
  const urlMatch = /\/join\/([A-Z0-9]{6})/i.exec(trimmed);
  if (urlMatch) {
    return urlMatch[1].toUpperCase();
  }
  // Otherwise treat as raw code - strip non-alphanumeric and uppercase
  return trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuthStore } from '@/stores/auth';
import { getElectronAPI } from '@/lib/ipc';

interface SessionInfo {
  id: string;
  join_code: string;
  status: string;
  settings: {
    quality?: string;
    allowControl?: boolean;
    maxParticipants?: number;
  };
  participant_count: number;
}

export function JoinPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);

  const [joinCode, setJoinCode] = useState(searchParams.get('code') ?? '');
  const [displayName, setDisplayName] = useState('');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;

    setError('');
    setLoading(true);
    setSession(null);

    try {
      const api = getElectronAPI();
      const result = await api.invoke('session:lookup', { joinCode: joinCode.trim() });

      if (!result.success) {
        setError(result.error);
        return;
      }

      setSession(result.session);
    } catch {
      setError('Failed to lookup session');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;

    // Require display name if not authenticated
    if (!user && !displayName.trim()) {
      setError('Please enter your name');
      return;
    }

    setError('');
    setJoining(true);

    try {
      const api = getElectronAPI();
      const result = await api.invoke('session:join', {
        joinCode: session.join_code,
        displayName: displayName.trim() || undefined,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      // Navigate to viewer page
      void navigate(`/viewer/${session.id}`);
    } catch {
      setError('Failed to join session');
    } finally {
      setJoining(false);
    }
  };

  const handleBack = () => {
    if (session) {
      setSession(null);
      setError('');
    } else {
      void navigate('/');
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Simple drag region for window control */}
      <div className="drag-region h-8 w-full" />

      <div className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md border-border">
          <CardHeader className="space-y-1 text-center">
            <div className="mb-4 flex justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Monitor className="h-6 w-6" />
              </div>
            </div>
            <CardTitle className="text-2xl font-semibold">
              {session ? 'Join Session' : 'Enter Join Code'}
            </CardTitle>
            <CardDescription>
              {session
                ? "You're about to join a screen sharing session"
                : 'Enter a join code or paste a link'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {!session ? (
              <form onSubmit={(e) => void handleLookup(e)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="joinCode">Join Code or Link</Label>
                  <Input
                    id="joinCode"
                    type="text"
                    value={joinCode}
                    onChange={(e) => {
                      setJoinCode(parseJoinInput(e.target.value));
                    }}
                    placeholder="ABC123 or paste link"
                    className="text-center font-mono text-lg"
                    autoFocus
                    required
                  />
                  <p className="text-center text-xs text-muted-foreground">
                    Enter the 6-character code or paste a join link
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={handleBack} className="flex-1">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <Button type="submit" className="flex-1" disabled={loading || !joinCode.trim()}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {loading ? 'Looking up...' : 'Continue'}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <div className="mb-6 rounded-lg bg-muted p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Session Code</span>
                    <span className="font-mono font-semibold">{session.join_code}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Participants</span>
                    <span className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      {session.participant_count} / {session.settings.maxParticipants ?? 5}
                    </span>
                  </div>
                </div>

                <form onSubmit={(e) => void handleJoin(e)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="displayName">
                      Your Name {user && <span className="text-muted-foreground">(optional)</span>}
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="displayName"
                        type="text"
                        value={displayName}
                        onChange={(e) => {
                          setDisplayName(e.target.value);
                        }}
                        placeholder={user ? 'Use account name' : 'Enter your name'}
                        className="pl-10"
                        maxLength={50}
                        required={!user}
                        autoFocus
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This is how others will see you in the session
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={handleBack} className="flex-1">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1"
                      disabled={joining || (!user && !displayName.trim())}
                    >
                      {joining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {joining ? 'Joining...' : 'Join Session'}
                    </Button>
                  </div>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
