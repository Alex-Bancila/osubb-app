import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageGrid } from './PageGrid';
import { Panel } from './Panel';
import { Section } from './Section';

function grid(container: HTMLElement) {
  return container.querySelector('[data-slot="page-grid"]') as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PageGrid', () => {
  it.each([
    [1, ['grid-cols-1'], ['md:grid-cols-2', 'xl:grid-cols-3']],
    [2, ['grid-cols-1', 'md:grid-cols-2'], ['xl:grid-cols-3']],
    // Three from xl, one below — never 2 + 1.
    [3, ['grid-cols-1', 'xl:grid-cols-3'], ['md:grid-cols-2']],
    [
      'collection',
      ['grid-cols-1', 'md:grid-cols-2', 'xl:grid-cols-3'],
      [] as string[],
    ],
  ] as const)(
    'columns=%s lays out the right columns per breakpoint',
    (columns, has, hasNot) => {
      const { container } = render(
        <PageGrid columns={columns}>
          <div>a</div>
        </PageGrid>,
      );
      expect(grid(container)).toHaveClass(...has);
      for (const name of hasNot) expect(grid(container)).not.toHaveClass(name);
    },
  );

  it('stretches every cell to the row: equal-height boxes, no overflowing column', () => {
    const { container } = render(
      <PageGrid columns={2}>
        <Panel title="Coordonare">Scurt</Panel>
        <Panel title="Evenimente viitoare">
          Un conținut mult mai lung, pe mai multe rânduri.
        </Panel>
      </PageGrid>,
    );
    expect(grid(container)).toHaveClass(
      'grid',
      'items-stretch',
      'gap-4',
      'md:gap-6',
      '*:h-full',
      '*:min-w-0',
    );
    // Each panel fills its cell and its box grows to the panel's height.
    for (const panel of container.querySelectorAll('[data-slot="panel"]'))
      expect(panel).toHaveClass('flex', 'h-full', 'flex-col');
    for (const box of container.querySelectorAll('[data-slot="panel-box"]'))
      expect(box).toHaveClass('flex-1');
  });

  it('renders as a list when asked', () => {
    render(
      <PageGrid columns="collection" as="ul" aria-label="Grupuri">
        <li>Educațional</li>
      </PageGrid>,
    );
    expect(screen.getByRole('list', { name: 'Grupuri' })).toHaveAttribute(
      'data-columns',
      'collection',
    );
  });

  it('warns in development when a panel renders null inside the grid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    function Hidden(): null {
      return null;
    }
    render(
      <PageGrid columns={2}>
        <Panel title="Punctajul meu">12</Panel>
        <Hidden />
      </PageGrid>,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('a panel returned null'),
    );
  });

  it('does not warn when the page leaves a panel out before rendering the grid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const show = false;
    render(
      <PageGrid columns={2}>
        <Panel title="Punctajul meu">12</Panel>
        {show && <Panel title="De evaluat">3</Panel>}
      </PageGrid>,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('Section', () => {
  it('is a band: an h2 header over exactly one grid', () => {
    const { container } = render(
      <Section title="Următoarele" columns={2}>
        <Panel level={3} title="Următorul task">
          a
        </Panel>
        <Panel level={3} title="Următorul eveniment">
          b
        </Panel>
      </Section>,
    );
    const band = screen.getByRole('region', { name: 'Următoarele' });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Următoarele' }),
    ).toBeInTheDocument();
    expect(band.querySelectorAll('[data-slot="page-grid"]')).toHaveLength(1);
    expect(grid(container)).toHaveClass('md:grid-cols-2');
    // Band after band: 32 px.
    expect(band).toHaveClass('[[data-slot=page-section]+&]:mt-7');
  });
});
