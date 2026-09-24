import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChannelWebsiteLink } from './ChannelWebsiteLink';

describe('ChannelWebsiteLink', () => {
  it('renders the hostname as an identity link that opens in a new tab', () => {
    render(<ChannelWebsiteLink url="https://www.cigarunderground.org" />);
    const link = screen.getByRole('link', { name: 'cigarunderground.org' });
    expect(link).toHaveAttribute('href', 'https://www.cigarunderground.org');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')?.split(' ')).toEqual(
      expect.arrayContaining(['noopener', 'me'])
    );
    expect(link).toHaveTextContent('cigarunderground.org', { normalizeWhitespace: true });
  });

  it('renders nothing when unset or not http(s)', () => {
    const { container, rerender } = render(<ChannelWebsiteLink url={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ChannelWebsiteLink url="javascript:alert(1)" />);
    expect(container).toBeEmptyDOMElement();
  });
});
