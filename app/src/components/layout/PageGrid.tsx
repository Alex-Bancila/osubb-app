import {
  Children,
  createElement,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { cn } from 'cn';
import { PageGridFillContext } from './grid-fill';

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
 * `alignHeaders`, from the width where cells first sit side by side: each
 * cell spans two implicit `auto` rows — header, then box — through a subgrid
 * with no gap of its own (the header's `mb-3` spaces it), and its header
 * keeps to the top of the header row. The box keeps to the top of the box
 * row too (`Panel`'s `self-start`) unless the grid has `equalHeights`.
 * The rows are `auto`, never `1fr`: in a grid of no set height every `1fr`
 * row takes the tallest one's height, so a short second row would stretch.
 */
const alignedRows: Record<PageGridColumns, string | undefined> = {
  1: undefined,
  2: 'md:*:row-span-2 md:*:grid md:*:grid-rows-subgrid md:*:gap-y-0 md:*:*:data-[slot=section-header]:self-start',
  3: 'xl:*:row-span-2 xl:*:grid xl:*:grid-rows-subgrid xl:*:gap-y-0 xl:*:*:data-[slot=section-header]:self-start',
  collection:
    'md:*:row-span-2 md:*:grid md:*:grid-rows-subgrid md:*:gap-y-0 md:*:*:data-[slot=section-header]:self-start',
};

type GridElement = 'div' | 'ul' | 'ol';

/**
 * The one grid. Gap 16 px under `md`, 24 px from `md` (the page gutter);
 * every cell is `min-w-0`, so a long word never widens a column.
 *
 * Heights (ruling of 2026-09-28, #876 — symmetry is aligned edges, gutters
 * and headers, never equal empty boxes):
 * - By default a cell is as tall as its content (`items-start`): unrelated
 *   panels never stretch to the tallest one. No box is more than ~1.3× its
 *   content; small unrelated panels stack in one column beside a tall one
 *   instead of stretching.
 * - `equalHeights` is only for rows of like items of similar size (Group
 *   cards, Task cards, directory cards): the row stretches, every cell is
 *   `h-full`, and a `Panel` cell (or the one `Panel` in a cell's `li`) grows
 *   its box to the row.
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
 * boxes next to it. Every box in a row starts on one line and each header
 * keeps to the top of its row, in both modes; the boxes also end together
 * only with `equalHeights`. Use it for rows of `Panel`s.
 */
export function PageGrid({
  columns,
  as: Element = 'div',
  alignHeaders = false,
  equalHeights = false,
  className,
  children,
  ...props
}: {
  columns: PageGridColumns;
  as?: GridElement;
  /** Line up the boxes of one row under headers of different heights. */
  alignHeaders?: boolean;
  /** Stretch each row to its tallest cell — only for like items. */
  equalHeights?: boolean;
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
  const grid = createElement(
    Element,
    {
      ...props,
      ref: setNode,
      'data-slot': 'page-grid',
      'data-columns': columns,
      'data-align-headers': alignHeaders || undefined,
      'data-equal-heights': equalHeights || undefined,
      className: cn(
        'm-0 grid list-none gap-4 p-0 md:gap-6 *:min-w-0',
        equalHeights ? 'items-stretch *:h-full' : 'items-start',
        gridColumns[columns],
        alignHeaders && alignedRows[columns],
        className,
      ),
    },
    children,
  );
  return <PageGridFillContext value={equalHeights}>{grid}</PageGridFillContext>;
}
