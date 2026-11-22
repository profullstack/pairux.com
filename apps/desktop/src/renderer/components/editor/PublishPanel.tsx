import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Copy, ExternalLink, Loader2, Lock, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getElectronAPI } from '@/lib/ipc';

/**
 * Remembered for this run of the app only when the user asks. Never written
 * to disk, never sent anywhere but the local c0mpute process.
 */
let sessionPassword: string | null = null;

interface PublishResult {
  ref: string;
  link: string | null;
  capability: string | null;
  size: number;
  browserOpenable: boolean;
}

export function PublishPanel({ file }: { file: string }) {
  const api = getElectronAPI();
  const [status, setStatus] = useState<{ installed: boolean; binary: string | null } | null>(null);
  const [password, setPassword] = useState(sessionPassword ?? '');
  const [remember, setRemember] = useState(sessionPassword !== null);
  const [publishing, setPublishing] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    void api.invoke('editor:c0mputeStatus', undefined).then(setStatus);
    return api.on('editor:publishLine', ({ line }) => {
      setLines((prev) => [...prev.slice(-200), line]);
    });
  }, [api]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  // A new export is a new file to publish.
  useEffect(() => {
    setResult(null);
    setError(null);
    setLines([]);
  }, [file]);

  const publish = async () => {
    setPublishing(true);
    setError(null);
    setLines([]);
    setResult(null);
    sessionPassword = remember && password ? password : null;
    const r = await api.invoke('editor:publish', { path: file, password: password || undefined });
    setPublishing(false);
    if (r.success) {
      setResult(r);
    } else if (!r.cancelled) {
      setError(
        r.locked ? 'Your c0mpute identity is locked. Enter its password and try again.' : r.error
      );
      if (r.locked) sessionPassword = null;
    }
  };

  const copy = async (text: string) => {
    await api.invoke('editor:copyText', { text });
    setCopied(text);
    setTimeout(() => {
      setCopied(null);
    }, 1500);
  };

  if (!status) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Publish privately to c0mpute</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Encrypted on this computer with your own c0mpute key (AES-256-GCM) before it leaves. Only
        people with the private link can watch it; PairUX never sees the key.
      </p>

      {!status.installed ? (
        <div className="rounded-md bg-muted p-3 text-xs">
          <p className="mb-2">The c0mpute app isn&apos;t installed on this computer.</p>
          <a
            href="https://c0mpute.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            Get c0mpute <ExternalLink className="h-3 w-3" />
          </a>
          <span className="text-muted-foreground"> then run </span>
          <code className="rounded bg-background px-1">c0mpute storage key init</code>
          <span className="text-muted-foreground"> once, and come back.</span>
        </div>
      ) : result ? (
        <div className="space-y-2 text-xs">
          {result.link && (
            <div>
              <p className="mb-1 font-medium">Private link</p>
              <div className="flex items-center gap-2">
                <Input readOnly value={result.link} className="h-8 font-mono text-xs" />
                <Button size="sm" variant="outline" onClick={() => void copy(result.link ?? '')}>
                  <Copy />
                  {copied === result.link ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="mt-1 text-muted-foreground">
                The key is in the part after <code>#k=</code>; anyone with the whole link can watch.
              </p>
            </div>
          )}
          <div>
            <p className="mb-1 font-medium">Owner reference</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={result.ref} className="h-8 font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={() => void copy(result.ref)}>
                <Copy />
                {copied === result.ref ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          {!result.browserOpenable && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This video is over 192 MB, so the browser link can&apos;t open it. Viewers need{' '}
              <code>c0mpute storage get {result.capability ?? result.ref}</code>. Export at a lower
              quality or trim further to share it as a link.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              type="password"
              autoComplete="off"
              placeholder="c0mpute identity password (blank if unlocked)"
              value={password}
              disabled={publishing}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              className="h-8 text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              disabled={publishing}
              onChange={(e) => {
                setRemember(e.target.checked);
              }}
            />
            Remember until PairUX quits (kept in memory, never saved)
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={publishing} onClick={() => void publish()}>
              {publishing ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              {publishing ? 'Encrypting and publishing…' : 'Publish to c0mpute'}
            </Button>
            {publishing && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void api.invoke('editor:cancelPublish', undefined)}
              >
                <X />
                Cancel
              </Button>
            )}
          </div>
          {publishing && (
            <p className="text-xs text-muted-foreground">
              This waits until the network holds enough copies, which can take a few minutes.
            </p>
          )}
        </div>
      )}

      {lines.length > 0 && !result && (
        <pre
          ref={logRef}
          className="mt-3 max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-[10px] leading-relaxed text-muted-foreground"
        >
          {lines.join('\n')}
        </pre>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
