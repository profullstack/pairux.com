import { useEffect, useState } from 'react';
import { Monitor, AppWindow, RefreshCw } from 'lucide-react';
import { getElectronAPI } from '../../lib/ipc';
import { SourceCard } from './SourceCard';
import type { CaptureSource } from '@pairux/shared-types';

interface SourcePickerProps {
  onSelect: (source: CaptureSource) => void;
}

type SourceType = 'screen' | 'window';

export function SourcePicker({ onSelect }: SourcePickerProps) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SourceType>('screen');

  const loadSources = async () => {
    setLoading(true);
    setError(null);

    try {
      const api = getElectronAPI();
      const result = await api.invoke('capture:getSources', {
        types: ['screen', 'window'],
      });
      setSources(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSources();
  }, []);

  const filteredSources = sources.filter((source) => source.type === activeTab);

  const screens = sources.filter((s) => s.type === 'screen');
  const windows = sources.filter((s) => s.type === 'window');

  return (
    <div className="flex flex-col gap-4">
      {/* Tab bar */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg bg-muted p-1">
          <button
            onClick={() => { setActiveTab('screen'); }}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'screen'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Monitor className="h-4 w-4" />
            Screens ({screens.length})
          </button>
          <button
            onClick={() => { setActiveTab('window'); }}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'window'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <AppWindow className="h-4 w-4" />
            Windows ({windows.length})
          </button>
        </div>

        <div className="flex-1" />

        <button
          onClick={() => { void loadSources(); }}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !sources.length && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Source grid */}
      {!loading && filteredSources.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          No {activeTab === 'screen' ? 'screens' : 'windows'} available
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {filteredSources.map((source) => (
          <SourceCard key={source.id} source={source} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
