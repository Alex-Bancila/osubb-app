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

  it('sizes every cell to its content by default: unrelated panels never stretch (#876)', () => {
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
      'items-start',
      'gap-4',
      'md:gap-6',
      '*:min-w-0',
    );
    expect(grid(container)).not.toHaveClass('items-stretch');
    expect(grid(container)).not.toHaveClass('*:h-full');
    expect(grid(container)).not.toHaveAttribute('data-equal-heights');
    // Each panel and its box keep to their content.
    for (const panel of container.querySelectorAll('[data-slot="panel"]')) {
      expect(panel).not.toHaveClass('h-full');
      expect(panel).not.toHaveAttribute('data-fill');
    }
    for (const box of container.querySelectorAll('[data-slot="panel-box"]')) {
      expect(box).toHaveClass('self-start', 'w-full');
      expect(box).not.toHaveClass('flex-1');
    }
  });

  it('equalHeights stretches a row of like items: every cell and box share the height', () => {
    const { container } = render(
      <PageGrid columns="collection" as="ul" equalHeights>
        <li>
          <Panel title="Educațional">Scurt</Panel>
        </li>
        <li>
          <Panel title="Resurse Umane">
            Un conținut mult mai lung, pe mai multe rânduri.
          </Panel>
        </li>
      </PageGrid>,
    );
    expect(grid(container)).toHaveClass('items-stretch', '*:h-full');
    expect(grid(container)).not.toHaveClass('items-start');
    expect(grid(container)).toHaveAttribute('data-equal-heights', 'true');
    // The one Panel in each li fills it, and its box grows to the row.
    for (const panel of container.querySelectorAll('[data-slot="panel"]')) {
      expect(panel).toHaveClass('flex', 'h-full', 'flex-col');
      expect(panel).toHaveAttribute('data-fill', 'true');
    }
    for (const box of container.querySelectorAll('[data-slot="panel-box"]')) {
      expect(box).toHaveClass('flex-1', 'self-stretch');
      expect(box).not.toHaveClass('self-start');
    }
  });

  it('a panel nested in a stretched one keeps to its content', () => {
    const { container } = render(
      <PageGrid columns={2} equalHeights>
        <Panel title="Exterior">
          <Panel title="Interior" level={3}>
            x
          </Panel>
        </Panel>
      </PageGrid>,
    );
    const inner = screen.getByRole('region', { name: 'Interior' });
    expect(inner).not.toHaveClass('h-full');
    expect(inner.querySelector('[data-slot="panel-box"]')).toHaveClass(
      'self-start',
    );
    expect(
      container.querySelector('[data-slot="panel"]') as HTMLElement,
    ).toHaveClass('h-full');
  });

  it('alignHeaders puts each panel on a two-row subgrid once cells sit side by side (X9)', () => {
    const { container, rerender } = render(
      <PageGrid columns={2} alignHeaders>
        <Panel title="Formular de adeziune" description="Un rând lung.">
          a
        </Panel>
        <Panel title="Adunarea Generală">b</Panel>
      </PageGrid>,
    );
    // auto rows, never 1fr: every 1fr row would take the tallest one's height.
    expect(grid(container).className).not.toMatch(/1fr/);
    expect(grid(container)).toHaveClass(
      'md:*:row-span-2',
      'md:*:grid-rows-subgrid',
      'md:*:gap-y-0',
    );
    // The box keeps to the second row even when a panel has no header.
    for (const box of container.querySelectorAll('[data-slot="panel-box"]'))
      expect(box).toHaveClass('row-start-2');
    // Default: the boxes start on one line but keep to their content.
    for (const box of container.querySelectorAll('[data-slot="panel-box"]'))
      expect(box).toHaveClass('self-start');
    rerender(
      <PageGrid columns={2} alignHeaders equalHeights>
        <Panel title="Formular de adeziune" description="Un rând lung.">
          a
        </Panel>
        <Panel title="Adunarea Generală">b</Panel>
      </PageGrid>,
    );
    // equalHeights keeps the subgrid and the boxes end together too.
    expect(grid(container)).toHaveClass(
      'md:*:row-span-2',
      'md:*:grid-rows-subgrid',
      'items-stretch',
    );
    for (const box of container.querySelectorAll('[data-slot="panel-box"]'))
      expect(box).toHaveClass('row-start-2', 'self-stretch');
    rerender(
      <PageGrid columns={3} alignHeaders>
        <Panel title="a">a</Panel>
      </PageGrid>,
    );
    expect(grid(container)).toHaveClass('xl:*:grid-rows-subgrid');
    expect(grid(container)).not.toHaveClass('md:*:grid-rows-subgrid');
    rerender(
      <PageGrid columns={2}>
        <Panel title="a">a</Panel>
      </PageGrid>,
    );
    expect(grid(container).className).not.toMatch(/subgrid/);
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
    // Band after band: the Page's 24 px gap plus 8 px = 32 px.
    expect(band).toHaveClass('[[data-slot=page-section]+&]:mt-2');
  });
});
