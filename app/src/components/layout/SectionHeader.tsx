import { type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { cn } from 'cn';
import { focusRingClass } from './focus';

export type SectionHeaderAction = {
  /** The link's words ("Vezi toate"). */
  label: string;
  /** The route it opens. */
  to: string;
};

/**
 * The one header above a band or a panel, everywhere.
 *
 * Rules:
 * - Eyebrow: 11.5 px, 800, uppercase, `tracking-[0.08em]`, muted, led by a
 *   16 px lucide icon in `--red-600`. A panel's eyebrow names where its data
 *   lives — usually the page its action opens (`Taskuri`, `Calendar`).
 * - Title: 19 px, 700, an `h2` (or `h3` inside an `h2` band). No other size,
 *   and nothing inside the section is larger: a block inside a panel is
 *   titled by `SubHeading`.
 * - Description: optional, 13 px, muted.
 * - Right side: either `action` — a red 14 px/700 link with an arrow and a
 *   44 px target — or a `control` (a toggle, a button).
 * - `min-h-11 mb-3`: headers in one row line up with or without an action,
 *   and the box starts 12 px below. A header that is only an eyebrow keeps
 *   `mb-3` and drops the 44 px row.
 */
export function SectionHeader({
  eyebrow,
  icon: Icon,
  title,
  titleId,
  level = 2,
  description,
  descriptionId,
  action,
  control,
  className,
}: {
  eyebrow?: ReactNode;
  icon?: LucideIcon;
  title?: ReactNode;
  /** Put on the heading so a `section` can be labelled by it. */
  titleId?: string;
  level?: 2 | 3;
  description?: ReactNode;
  /** Put on the description so a control can be described by it. */
  descriptionId?: string;
  action?: SectionHeaderAction;
  control?: ReactNode;
  className?: string;
}) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <div
      data-slot="section-header"
      className={cn(
        'mb-3 flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-2',
        // A lone eyebrow (a filter box's "Filtre") needs no 44 px row.
        (title || action || control) && 'min-h-11',
        className,
      )}
    >
      {/* basis-40, not 64: at 375 px a ~110 px action still fits beside
          160 px of title, so the title wraps before the action drops to a
          row of its own (layout X8). */}
      <div className="min-w-0 flex-1 basis-40">
        {eyebrow && (
          <p
            data-slot="section-eyebrow"
            className="flex items-center gap-1.5 text-[length:var(--fs-xs)] font-extrabold tracking-[0.08em] text-muted-foreground uppercase"
          >
            {Icon && (
              <Icon
                aria-hidden="true"
                className="size-4 shrink-0 text-(--red-600)"
              />
            )}
            {eyebrow}
          </p>
        )}
        {title && (
          <Heading
            id={titleId}
            className="m-0 text-[length:var(--fs-lg)] leading-snug font-bold wrap-anywhere"
          >
            {title}
          </Heading>
        )}
        {description && (
          <p
            id={descriptionId}
            className="mt-0.5 text-[length:var(--fs-sm)] text-muted-foreground"
          >
            {description}
          </p>
        )}
      </div>
      {action ? (
        <Link
          to={action.to}
          data-slot="section-action"
          className={cn(
            'inline-flex min-h-11 min-w-11 shrink-0 items-center gap-1 rounded-sm text-sm font-bold text-(--red-600) underline-offset-4 hover:underline',
            focusRingClass,
          )}
        >
          {action.label}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : (
        control && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {control}
          </div>
        )
      )}
    </div>
  );
}
