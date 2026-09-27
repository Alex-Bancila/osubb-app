import { type ReactNode } from 'react';
import { cn } from 'cn';
import { usePageTitleId } from './page-context';

/**
 * The one page header: eyebrow, `h1`, an optional one-sentence description
 * and, on the right, the page's actions.
 *
 * Rules:
 * - Every page header has an eyebrow — `OSUBB` by default, the area for
 *   sub-areas (`OSUBB · Conducere`, `OSUBB · Administrare`).
 * - The title is 31 px (24 px under 768 px), weight 800 — the only `h1` size.
 * - Under 640 px the actions stack below the text at full width; from 640 px
 *   they sit on the right, aligned to the bottom of the text.
 * - 24 px below the header (`mb-6`).
 */
export function PageHeader({
  eyebrow = 'OSUBB',
  title,
  badge,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Sits beside the title on the same line (a status badge). */
  badge?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const titleId = usePageTitleId();
  return (
    <header
      data-slot="page-header"
      className={cn(
        'mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <p
          data-slot="page-eyebrow"
          className="mb-2 text-[length:var(--fs-xs)] font-extrabold tracking-[0.08em] text-(--red-600) uppercase"
        >
          {eyebrow}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1
            id={titleId}
            className="m-0 text-[length:var(--fs-xl)] leading-tight font-extrabold tracking-[-0.02em] text-balance wrap-anywhere md:text-[length:var(--fs-2xl)]"
          >
            {title}
          </h1>
          {badge}
        </div>
        {description && (
          <p
            data-slot="page-description"
            className="mt-2 max-w-[38rem] leading-relaxed text-muted-foreground"
          >
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div
          data-slot="page-actions"
          className="flex w-full min-w-0 flex-wrap items-center gap-2 empty:hidden sm:w-auto sm:shrink-0 sm:justify-end"
        >
          {actions}
        </div>
      )}
    </header>
  );
}
