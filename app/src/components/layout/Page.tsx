import { useId, type ComponentProps } from 'react';
import { cn } from 'cn';
import { PageTitleContext } from './page-context';

export type PageWidth = 'wide' | 'reading';

const widths: Record<PageWidth, string> = {
  wide: 'max-w-(--content-max)',
  reading: 'max-w-3xl',
};

/**
 * The frame every screen's content sits in (ruling R27, plan §1).
 *
 * Rules an implementer never re-decides:
 * - Gutter 16 px under `md` (768 px), 24 px from `md`; the same top and bottom.
 * - Width `wide` (default) is `--content-max` (1240 px); `reading` is
 *   `max-w-3xl` (768 px), for single-column text pages.
 * - A screen never sets its own `max-w-*` or padding frame — it takes a
 *   `Page`. The shell scrolls the page; the page never sets its own height,
 *   and nothing in it may scroll the page sideways at 375 px (`min-w-0`).
 * - Blocks inside the page stack 24 px apart (`space-y-6`); a `Section`
 *   after a `Section` is 32 px below it.
 * - The page is a `section` labelled by its `PageHeader`'s `h1`; a page that
 *   has no header yet (a loading or not-found state) passes `aria-label`.
 */
export function Page({
  width = 'wide',
  className,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'aria-labelledby'> & {
  width?: PageWidth;
}) {
  const titleId = useId();
  return (
    <PageTitleContext.Provider value={titleId}>
      <section
        data-slot="page"
        data-width={width}
        aria-labelledby={props['aria-label'] ? undefined : titleId}
        className={cn(
          'mx-auto w-full min-w-0 space-y-6 px-4 py-4 md:px-6 md:py-6',
          widths[width],
          className,
        )}
        {...props}
      >
        {children}
      </section>
    </PageTitleContext.Provider>
  );
}
