import { footerHtml } from '@profullstack/footer';

const options = {
  site: 'https://pairux.com/',
  owner: { name: 'PairUX', url: 'https://pairux.com/' },
  links: [
    { label: 'Features', href: '/features' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Download', href: '/download' },
    { label: 'Documentation', href: '/docs' },
    { label: 'Blog', href: '/blog' },
    { label: 'About', href: '/about' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
    { label: 'GitHub', href: 'https://github.com/profullstack/pairux.com', rel: 'noopener noreferrer' },
    { label: 'Discord', href: 'https://discord.gg/U7dEXfBA3s', rel: 'noopener noreferrer' },
    { label: 'X', href: 'https://x.com/profullstackinc', rel: 'noopener noreferrer' },
  ],
  builtIndieHref: 'https://built.indie.pit.world/for?site=https://pairux.com/',
  pwamartHref: 'https://pwamart.com/for?site=https://pairux.com/',
};

export async function UniversalFooter({ nonce }: { nonce?: string | undefined }) {
  const html = await footerHtml({ ...options, ...(nonce ? { nonce } : {}) });
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
