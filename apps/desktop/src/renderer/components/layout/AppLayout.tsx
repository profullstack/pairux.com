import type { ReactNode } from 'react';
import { TitleBar } from './TitleBar';
import { SettingsPage } from '@/routes/settings';
import { useUIStore } from '@/stores/ui';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const settingsOpen = useUIStore((s) => s.settingsOpen);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TitleBar />
      <main className="relative flex flex-1 flex-col">
        {children}

        {/* Settings is an overlay rather than a route so opening it keeps Home
            (and the active session) mounted underneath. Scoped to the content
            area so the title bar / window controls stay usable. */}
        {settingsOpen && (
          <div className="absolute inset-0 z-50 flex flex-col overflow-auto bg-background">
            <SettingsPage />
          </div>
        )}
      </main>
    </div>
  );
}
