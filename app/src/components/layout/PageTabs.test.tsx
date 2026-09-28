import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PageTabs, tabClass, tabListClass } from './PageTabs';

const tabs = [
  { to: '/administrare', label: 'Membri', end: true },
  { to: '/administrare/grupuri', label: 'Grupuri' },
  { to: '/administrare/perioade', label: 'Perioade' },
];

describe('PageTabs', () => {
  it('marks the current route with aria-current="page", and only it', () => {
    render(
      <MemoryRouter initialEntries={['/administrare/grupuri']}>
        <PageTabs label="Secțiuni Administrare" tabs={tabs} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', {
      name: 'Secțiuni Administrare',
    });
    expect(nav).toHaveClass(...tabListClass.split(' '));
    expect(screen.getByRole('link', { name: 'Grupuri' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // `end` keeps the parent tab from matching its children.
    expect(screen.getByRole('link', { name: 'Membri' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: 'Perioade' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('gives every tab a 44 px target, the text colour and a visible focus ring (X1, X6)', () => {
    render(
      <MemoryRouter>
        <PageTabs label="Secțiuni" tabs={tabs} />
      </MemoryRouter>,
    );
    for (const link of screen.getAllByRole('link'))
      expect(link).toHaveClass(
        'min-h-11',
        'min-w-11',
        'focus-visible:outline-2',
        'focus-visible:outline-solid',
        'text-foreground',
        'hover:bg-muted',
        'shrink-0',
        'aria-[current=page]:bg-primary',
        'aria-[current=page]:text-primary-foreground',
      );
    // The same look for Base UI Tabs (data-active) and a tablist.
    expect(tabClass).toContain('data-active:bg-primary');
    expect(tabClass).toContain('aria-selected:bg-primary');
  });

  it('is one scrolling row under 640 px and wraps from 640 px (X7)', () => {
    render(
      <MemoryRouter>
        <PageTabs label="Secțiuni" tabs={tabs} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Secțiuni' });
    expect(nav).toHaveClass(
      'sm:flex-wrap',
      'max-sm:overflow-x-auto',
      'max-sm:snap-x',
      'max-sm:-mx-4',
    );
    expect(nav).not.toHaveClass('flex-wrap');
    // No margin of its own: the Page's gap spaces it.
    expect(nav.className).not.toMatch(/(^| )mb-/);
    for (const link of screen.getAllByRole('link'))
      expect(link).toHaveClass('snap-start', 'whitespace-nowrap');
  });
});
