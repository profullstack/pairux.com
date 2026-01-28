import type { ReactNode } from 'react';
import { TitleBar } from './TitleBar';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TitleBar />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
