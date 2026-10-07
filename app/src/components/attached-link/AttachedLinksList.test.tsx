import * as axe from 'axe-core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AttachedLinksList } from './AttachedLinksList';

const links = [
  { label: 'Formular', url: 'https://osubb.ro/formular' },
  { label: 'Program', url: 'https://osubb.ro/program' },
];

describe('AttachedLinksList (ruling R46)', () => {
  it('shows the bare label on a card, in order', async () => {
    const { container } = render(
      <AttachedLinksList links={links} variant="card" />,
    );
    const list = screen.getByRole('list', { name: 'Linkuri atașate' });
    const items = within(list).getAllByRole('link');
    expect(items.map((item) => item.textContent)).toEqual([
      'Formular',
      'Program',
    ]);
    expect(items[0]).toHaveAccessibleName(
      'Formular (se deschide într-o filă nouă)',
    );
    expect(screen.queryByText(/Deschide/)).toBeNull();
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('reads "Deschide: <etichetă>" in a details view', () => {
    render(<AttachedLinksList links={links} variant="details" />);
    const formular = screen.getByRole('link', {
      name: 'Deschide: Formular (se deschide într-o filă nouă)',
    });
    expect(formular).toHaveTextContent('Deschide: Formular');
    expect(formular).toHaveAttribute('href', 'https://osubb.ro/formular');
    expect(formular).toHaveAttribute('target', '_blank');
    expect(formular).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      screen.getByRole('link', { name: /^Deschide: Program/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Deschide formular/)).toBeNull();
  });

  it('leaves out an address that is not http(s), and renders nothing when none is left', () => {
    const { rerender } = render(
      <AttachedLinksList
        links={[
          { label: 'Rău', url: 'javascript:alert(1)' },
          { label: 'Program', url: 'https://osubb.ro/program' },
        ]}
        variant="card"
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    rerender(
      <AttachedLinksList
        links={[{ label: 'Rău', url: 'data:text/html,hi' }]}
        variant="card"
      />,
    );
    expect(screen.queryByRole('list')).toBeNull();
    rerender(<AttachedLinksList links={[]} variant="details" />);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
