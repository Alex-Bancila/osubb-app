import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Users } from 'lucide-react';
import { PageTabs, tabClass, tabLabelsFrom, tabListClass } from './PageTabs';

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

  it('gives every tab a 44 px hit area, a visible focus ring and the inked selected state', () => {
    render(
      <MemoryRouter>
        <PageTabs label="Secțiuni" tabs={tabs} />
      </MemoryRouter>,
    );
    for (const link of screen.getAllByRole('link'))
      expect(link).toHaveClass(
        'min-h-[36px]',
        'after:-inset-y-1',
        'min-w-11',
        'focus-visible:outline-2',
        'focus-visible:outline-solid',
        'aria-[current=page]:bg-(--text)',
        'aria-[current=page]:text-(--surface)',
      );
    // The same look for Base UI Tabs (data-active) and a tablist; no tab
    // bar in the app is red any more.
    expect(tabClass).toContain('data-active:bg-(--text)');
    expect(tabClass).toContain('aria-selected:bg-(--text)');
    expect(tabClass).not.toContain('bg-primary');
  });

  it('is one pill track as wide as its column, with no margin of its own', () => {
    render(
      <MemoryRouter>
        <PageTabs label="Secțiuni" tabs={tabs} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Secțiuni' });
    expect(nav).toHaveClass('w-full', 'rounded-lg', 'border', 'p-[3px]');
    expect(nav.className).not.toMatch(/(^|[\s:])flex-wrap/);
    expect(nav.className).not.toMatch(/(^| )-?m[bxy]-/);
    // Each tab takes its share of the track.
    for (const link of screen.getAllByRole('link'))
      expect(link).toHaveClass('flex-auto', 'whitespace-nowrap');
  });

  it('with `labelsFrom`, keeps every name but lets only the current tab draw it below that width', () => {
    render(
      <MemoryRouter initialEntries={['/administrare/grupuri']}>
        <PageTabs
          label="Secțiuni"
          labelsFrom="lg"
          tabs={tabs.map((tab) => ({ ...tab, icon: Users }))}
        />
      </MemoryRouter>,
    );
    for (const link of screen.getAllByRole('link')) {
      expect(link.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(link).toHaveClass('max-lg:flex-none');
    }
    expect(screen.getByRole('link', { name: 'Membri' })).toBeInTheDocument();
    expect(screen.getByText('Membri')).toHaveClass(
      'max-lg:sr-only',
      'max-lg:in-aria-[current=page]:not-sr-only',
    );
    expect(tabLabelsFrom.always.tab).toBe('');
  });

  it('scrolls sideways when its tabs do not fit, with no scrollbar and no shrinking tabs', () => {
    render(
      <MemoryRouter>
        <PageTabs label="Secțiuni" tabs={tabs} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Secțiuni' });
    expect(nav).toHaveClass(
      'overflow-x-auto',
      'overflow-y-hidden',
      '[scrollbar-width:none]',
      '[&::-webkit-scrollbar]:hidden',
    );
    for (const link of screen.getAllByRole('link'))
      expect(link).toHaveClass('shrink-0');
    // Labels never truncate any more: the track scrolls instead.
    for (const size of Object.values(tabLabelsFrom))
      expect(size.label).not.toContain('truncate');
  });

  it("brings the current tab into the track's view by scrolling the track itself, never the page", () => {
    // jsdom lays nothing out: the current tab is declared to sit at 500–600 px
    // in a 300 px track, so only its right edge decides the scroll.
    const offsetLeft = vi
      .spyOn(HTMLElement.prototype, 'offsetLeft', 'get')
      .mockReturnValue(500);
    const offsetWidth = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(100);
    const clientWidth = vi
      .spyOn(Element.prototype, 'clientWidth', 'get')
      .mockReturnValue(300);
    try {
      render(
        <MemoryRouter initialEntries={['/administrare/grupuri']}>
          <PageTabs label="Secțiuni" tabs={tabs} />
        </MemoryRouter>,
      );
      const nav = screen.getByRole('navigation', { name: 'Secțiuni' });
      expect(nav.scrollLeft).toBe(300);
      expect(window.scrollX).toBe(0);
    } finally {
      offsetLeft.mockRestore();
      offsetWidth.mockRestore();
      clientWidth.mockRestore();
    }
  });
});
