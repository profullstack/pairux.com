import { useEffect, useState } from 'react';
import { Download, Copy, Check, X } from 'lucide-react';
import { getElectronAPI } from '@/lib/ipc';

/**
 * A thin banner shown when a newer desktop release is available on GitHub.
 * Tells the user to run `pairux update` (the installer's update command).
 */
export function UpdateBanner() {
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await getElectronAPI().invoke('app:check-update', undefined);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cancelled flips in cleanup
        if (!cancelled && r.updateAvailable && r.latest) setLatest(r.latest);
      } catch {
        /* offline / rate-limited — no banner */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!latest || dismissed) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText('pairux update');
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="flex items-center gap-2 bg-primary px-4 py-2 text-sm text-primary-foreground">
      <Download className="h-4 w-4 shrink-0" />
      <span>
        Update available — <span className="font-semibold">v{latest}</span>. Run{' '}
        <code className="rounded bg-white/20 px-1 py-0.5 font-mono text-xs">pairux update</code> to
        upgrade.
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-xs font-medium hover:bg-white/25"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
        }}
        className="ml-auto rounded p-0.5 hover:bg-white/20"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
