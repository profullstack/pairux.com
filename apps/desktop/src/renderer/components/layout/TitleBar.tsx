import { Monitor } from 'lucide-react';
import { isElectron, getElectronAPI } from '../../lib/ipc';

export function TitleBar() {
  const platform = isElectron() ? getElectronAPI().platform : 'unknown';
  const isMac = platform === 'darwin';

  return (
    <header
      className={`drag-region flex h-10 shrink-0 items-center border-b border-border bg-card ${
        isMac ? 'pl-20' : 'pl-4'
      } pr-4`}
    >
      <div className="no-drag flex items-center gap-2">
        <Monitor className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">PairUX</span>
      </div>

      <div className="flex-1" />

      <div className="no-drag flex items-center gap-2 text-xs text-muted-foreground">
        <span>Desktop</span>
      </div>
    </header>
  );
}
