import {
  Children,
  createElement,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { cn } from 'cn';

export type PageGridColumns = 1 | 2 | 3 | 'collection';

/**
 * The column classes per `columns` value, at the app's breakpoints (the
 * sidebar appears at `lg`, 1024 px):
 * - `1`: one column at every width.
 * - `2`: one column, two from `md` (768 px). Four panels make a 2 × 2.
 * - `3`: one column, three from `xl` (1280 px) — never 2 + 1.
 * - `collection`: one, two from `md`, three from `xl` — lists of like items.
 */
const gridColumns: Record<PageGridColumns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 xl:grid-cols-3',
  collection: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
};

/**
 * `alignHeaders`, from the width where cells first sit side by side: rows
 * alternate header (`auto`) and box (`1fr`); each cell spans a pair through
 * a subgrid with no gap of its own (the header's `mb-3` spaces it), and its
 * header keeps to the top of the header row.
 */
const alignedRows: Record<PageGridColumns, string | undefined> = {
  1: undefined,
  2: 'md:auto-rows-[auto_1fr] md:*:row-span-2 md:*:grid md:*:grid-rows-subgrid md:*:gap-y-0 md:*:*:data-[slot=section-header]:self-start',
  3: 'xl:auto-rows-[auto_1fr] xl:*:row-span-2 xl:*:grid xl:*:grid-rows-subgrid xl:*:gap-y-0 xl:*:*:data-[slot=section-header]:self-start',
  collection:
    'md:auto-rows-[auto_1fr] md:*:row-span-2 md:*:grid md:*:grid-rows-subgrid md:*:gap-y-0 md:*:*:data-[slot=section-header]:self-start',
};

type GridElement = 'div' | 'ul' | 'ol';

/**
 * The one grid. Gap 16 px under `md`, 24 px from `md` (the page gutter);
 * rows stretch, and every cell is `h-full min-w-0`, so the boxes in a row
 * share one height and a long word never widens a column.
 *
 * Rule: a panel never renders `null` inside a `PageGrid`. The page decides
 * which cells exist before it renders the grid (`{show && <Panel …/>}` is
 * fine); a cell shows its own loading, error or empty state. In development
 * a cell that rendered nothing is reported with `console.warn`.
 *
 * `as="ul"` / `"ol"` for a list of like items — its children are then `li`s.
 *
 * `alignHeaders` (layout X9): once the cells sit side by side, each cell
 * spans two grid rows — its header, then its box — through a subgrid, so a
 * header that wraps or carries a description never pushes its box below the
 * boxes next to it. Every box in a row starts and ends together, and each
 * header keeps to the top of its row. Use it for rows of `Panel`s.
 */
export function PageGrid({
  columns,
  as: Element = 'div',
  alignHeaders = false,
  className,
  children,
  ...props
}: {
  columns: PageGridColumns;
  as?: GridElement;
  /** Line up the boxes of one row under headers of different heights. */
  alignHeaders?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentProps<'div'>, 'className' | 'children' | 'ref'>) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const expected = Children.toArray(children).length;
  useEffect(() => {
    if (!import.meta.env.DEV || !node) return;
    const rendered = node.childElementCount;
    if (rendered < expected)
      console.warn(
        `PageGrid: ${expected} cells were given but ${rendered} rendered — a panel returned null. Decide which panels exist before rendering the grid, and show Loading / ErrorState / EmptyState inside the panel.`,
      );
  });
  // createElement, because one prop type cannot describe div, ul and ol.
  return createElement(
    Element,
    {
      ...props,
      ref: setNode,
      'data-slot': 'page-grid',
      'data-columns': columns,
      'data-align-headers': alignHeaders || undefined,
      className: cn(
        'm-0 grid list-none items-stretch gap-4 p-0 md:gap-6 *:h-full *:min-w-0',
        gridColumns[columns],
        alignHeaders && alignedRows[columns],
        className,
      ),
    },
    children,
  );
}
