import { ExternalLink } from 'lucide-react';
import { websiteLabel } from '@/lib/channel-website';

interface ChannelWebsiteLinkProps {
  url: string | null | undefined;
  className?: string;
}

/**
 * The channel's own website, labelled with its hostname. rel="me" makes it an
 * identity link (the site can link back to /@handle with rel="me" to verify);
 * noopener because it opens in a new tab. Renders nothing for an unset or
 * unparseable URL.
 */
export function ChannelWebsiteLink({ url, className }: ChannelWebsiteLinkProps) {
  const label = websiteLabel(url);
  if (!url || !label) return null;
  return (
    // noopener without noreferrer on purpose: the owner's site should see the
    // pairux.com referrer in its analytics. noopener alone closes the
    // window.opener hole the rule exists for.
    // eslint-disable-next-line react/jsx-no-target-blank
    <a
      href={url}
      target="_blank"
      rel="noopener me"
      className={
        className ??
        'text-primary-600 inline-flex items-center gap-1 text-sm font-medium hover:underline'
      }
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}
