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
    <div className="gap-4 flex flex-col">
      {/* Tab bar */}
      <div className="gap-2 flex items-center">
        <div className="rounded-lg bg-muted p-1 flex">
          <button
            onClick={() => {
              setActiveTab('screen');
            }}
            className={`gap-2 rounded-md px-4 py-2 text-sm font-medium flex items-center transition-colors ${
              activeTab === 'screen'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Monitor className="h-4 w-4" />
            Screens ({screens.length})
          </button>
          <button
            onClick={() => {
              setActiveTab('window');
            }}
            className={`gap-2 rounded-md px-4 py-2 text-sm font-medium flex items-center transition-colors ${
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
          onClick={() => {
            void loadSources();
          }}
          disabled={loading}
          className="gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground flex items-center transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Error state */}
      {error && <div className="rounded-lg bg-destructive/10 p-4 text-destructive">{error}</div>}

      {/* Loading state */}
      {loading && !sources.length && (
        <div className="py-12 flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Source grid */}
      {!loading && filteredSources.length === 0 && (
        <div className="py-12 text-muted-foreground text-center">
          No {activeTab === 'screen' ? 'screens' : 'windows'} available
        </div>
      )}

      <div className="gap-4 lg:grid-cols-3 xl:grid-cols-4 grid grid-cols-2">
        {filteredSources.map((source) => (
          <SourceCard key={source.id} source={source} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
