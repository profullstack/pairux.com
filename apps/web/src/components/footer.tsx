import Link from 'next/link';
import { headers } from 'next/headers';
import { Footer as PfsFooter } from '@profullstack/footer/react';
import { useTranslations } from 'next-intl';
import { Logo } from '@/components/Logo';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

// Custom GitHub icon SVG component (brand icons deprecated in lucide)
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// Custom Twitter/X icon SVG component
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.36-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12z" />
    </svg>
  );
}

function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

// The links people need, one row. Message keys live under footer.links.*.
// The pit.world network footer follows this one (root layout, last in <body>).
const footerLinks = [
  { key: 'features', href: '/features' },
  { key: 'pricing', href: '/pricing' },
  { key: 'download', href: '/download' },
  { key: 'documentation', href: '/docs' },
  { key: 'blog', href: '/blog' },
  { key: 'about', href: '/about' },
  { key: 'privacy', href: '/privacy' },
  { key: 'terms', href: '/terms' },
];

const socialLinks = [
  {
    name: 'GitHub',
    href: 'https://github.com/profullstack/pairux.com',
    icon: GitHubIcon,
  },
  {
    name: 'Discord',
    href: 'https://discord.gg/U7dEXfBA3s',
    icon: DiscordIcon,
  },
  {
    name: 'X',
    href: 'https://x.com/profullstackinc',
    icon: TwitterIcon,
  },
];

/**
 * The ring footer with the request's CSP nonce (middleware sets x-nonce), so the
 * newsletter form's inline script (@profullstack/footer 0.4.0) runs under
 * script-src 'nonce-...'.
 */
async function RingFooter({ tagline }: { tagline: string }) {
  const nonce = (await headers()).get('x-nonce');
  // exactOptionalPropertyTypes: pass nonce only when there is one.
  return <PfsFooter site="https://pairux.com/" tagline={tagline} {...(nonce ? { nonce } : {})} />;
}

export function Footer() {
  const t = useTranslations('footer');
  return (
    <footer className="border-t border-gray-200 bg-gray-50 text-sm text-gray-600">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Logo size="sm" />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            {footerLinks.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="transition-colors hover:text-gray-900"
              >
                {t(`links.${item.key}`)}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-4">
          {socialLinks.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 transition-colors hover:text-gray-900"
            >
              <span className="sr-only">{item.name}</span>
              <item.icon className="h-5 w-5" />
            </Link>
          ))}
          <LanguageSwitcher id="language-switcher-footer" />
        </div>
        {/* Copyright + Profullstack ring, from @profullstack/footer */}
        <RingFooter tagline={t('license')} />
      </div>
    </footer>
  );
}
