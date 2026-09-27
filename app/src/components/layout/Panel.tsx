import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from 'cn';
import { SectionHeader, type SectionHeaderAction } from './SectionHeader';

/**
 * The box classes: 16 px padding at every width (the `TaskCard` spacing, so
 * an item card and a panel line up), radius `--r-md` (13 px), the surface
 * colour and the small shadow. `rounded-xl` (24 px) is not used for boxes.
 */
export const panelBoxClass =
  'min-w-0 flex-1 rounded-md border border-border bg-card p-4 text-card-foreground shadow-(--sh-sm)';

/**
 * One panel: a `SectionHeader` **above** one box. The panel is a
 * `flex h-full flex-col` section and the box grows (`flex-1`), so in a
 * `PageGrid` row every box has the same height whatever it holds.
 *
 * Rules:
 * - The header sits outside the box; the box holds content only.
 * - A panel never renders `null` inside a `PageGrid`: it shows `Loading`,
 *   `ErrorState` or `EmptyState` in its box instead.
 * - `bare` drops the box, for a child that is itself a card (`TaskCard`,
 *   `EventCard`).
 * - Labelled by its title when it has one; otherwise pass `aria-label`.
 */
export function Panel({
  eyebrow,
  icon,
  title,
  level = 2,
  description,
  descriptionId,
  action,
  control,
  bare = false,
  className,
  boxClassName,
  children,
  'aria-label': ariaLabel,
}: {
  eyebrow?: ReactNode;
  icon?: LucideIcon;
  title?: ReactNode;
  level?: 2 | 3;
  description?: ReactNode;
  descriptionId?: string;
  action?: SectionHeaderAction;
  control?: ReactNode;
  bare?: boolean;
  className?: string;
  boxClassName?: string;
  children?: ReactNode;
  'aria-label'?: string;
}) {
  const titleId = useId();
  const hasHeader = Boolean(
    eyebrow || title || description || action || control,
  );
  return (
    <section
      data-slot="panel"
      aria-labelledby={title && !ariaLabel ? titleId : undefined}
      aria-label={ariaLabel}
      className={cn('flex h-full min-w-0 flex-col', className)}
    >
      {hasHeader && (
        <SectionHeader
          eyebrow={eyebrow}
          icon={icon}
          title={title}
          titleId={titleId}
          level={level}
          description={description}
          descriptionId={descriptionId}
          action={action}
          control={control}
        />
      )}
      {bare ? (
        <div
          data-slot="panel-body"
          className={cn('flex min-w-0 flex-1 flex-col', boxClassName)}
        >
          {children}
        </div>
      ) : (
        <div data-slot="panel-box" className={cn(panelBoxClass, boxClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}
