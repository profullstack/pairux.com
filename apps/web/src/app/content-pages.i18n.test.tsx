import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen } from '@/test/intl';
import FeaturesPage from './features/page';
import CallAnalysisFeaturePage from './features/call-analysis/page';
import UseCasesPage from './use-cases/page';
import AgenticPairProgrammingPage from './use-cases/agentic-pair-programming/page';
import AboutPage from './about/page';
import DocsPage from './docs/page';
import AgentDocsPage from './docs/agents/page';
import ChangelogPage from './changelog/page';
import PrivacyPage from './privacy/page';
import TermsPage from './terms/page';

// Site chrome is not under test: Header is an async server component (Supabase
// lookup) and the Footer's Profullstack ring suspends on a fetch.
vi.mock('@/components/header', () => ({ Header: () => null }));
vi.mock('@/components/footer', () => ({ Footer: () => null }));

const KEY_PATH = /\b(features|useCases|about|docs|changelog|legal|blog)\.[a-zA-Z]+\.[\w.]+/;

const pages: [string, () => ReactElement][] = [
  ['features', () => <FeaturesPage />],
  ['call analysis', () => <CallAnalysisFeaturePage />],
  ['use cases', () => <UseCasesPage />],
  ['agentic pair programming', () => <AgenticPairProgrammingPage />],
  ['about', () => <AboutPage />],
  ['docs', () => <DocsPage />],
  ['agent docs', () => <AgentDocsPage />],
  ['changelog', () => <ChangelogPage />],
  ['privacy', () => <PrivacyPage />],
  ['terms', () => <TermsPage />],
];

describe('content pages render every message', () => {
  it.each(pages)('%s has no unresolved message keys', (_name, page) => {
    const { container } = render(page());
    expect(container.textContent.length).toBeGreaterThan(100);
    expect(container.textContent).not.toMatch(KEY_PATH);
  });

  it('renders English copy and localized dates', () => {
    render(<FeaturesPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'AI Call Analysis' })).toBeInTheDocument();
    expect(screen.getByText('Talk time, pace and filler words per speaker')).toBeInTheDocument();
  });

  it('formats changelog months with the active locale', () => {
    render(<ChangelogPage />);
    expect(screen.getAllByText('August 2026').length).toBeGreaterThan(0);
    expect(screen.queryByText('Release notes are published in English.')).toBeNull();
  });
});
