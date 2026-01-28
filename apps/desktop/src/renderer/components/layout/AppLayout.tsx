import type { ReactNode } from 'react';
import { TitleBar } from './TitleBar';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <TitleBar />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
