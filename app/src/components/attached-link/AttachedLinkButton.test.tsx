import * as axe from 'axe-core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AttachedLinkButton } from './AttachedLinkButton';

describe('AttachedLinkButton', () => {
  it('renders the label as a button-styled link, opening a new tab safely', async () => {
    const { container } = render(
      <AttachedLinkButton label="Formular" url="https://osubb.ro/formular" />,
    );

    const link = screen.getByRole('link', {
      name: 'Formular (se deschide într-o filă nouă)',
    });
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent('Formular');
    expect(link).toHaveAttribute('href', 'https://osubb.ro/formular');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('accepts http, not only https', () => {
    render(<AttachedLinkButton label="Formular" url="http://osubb.ro" />);
    expect(screen.getByRole('link', { name: /Formular/ })).toHaveAttribute(
      'href',
      'http://osubb.ro',
    );
  });

  it('renders nothing when the label is missing', () => {
    render(<AttachedLinkButton label={null} url="https://osubb.ro" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders nothing when the address is missing', () => {
    render(<AttachedLinkButton label="Formular" url={null} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders nothing when the label is blank', () => {
    render(<AttachedLinkButton label="" url="https://osubb.ro" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each([
    ['ftp://osubb.ro'],
    ['javascript:alert(1)'],
    ['osubb.ro'],
    [' https://osubb.ro'],
  ])('renders nothing for a non-http(s) address %j', (url) => {
    render(<AttachedLinkButton label="Formular" url={url} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
