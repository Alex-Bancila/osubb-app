import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from 'cn';
import { SectionHeader, type SectionHeaderAction } from './SectionHeader';
import { stackClass, type PanelStack } from './stack';

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
 * - `stack` spaces the box's blocks with a flex gap (12 px for a line of text
 *   over a form, 16 px between forms) — never `space-y-*`.
 * - `flush` is for a box that holds one `ListRow` list: the box loses its
 *   padding and the rows take `px-4`, so a row (its tint, its name) reaches
 *   the frame instead of sitting inset in a second border (layout L1, O1).
 * - In a `PageGrid` with `alignHeaders`, the box always sits in the second
 *   row of the panel's subgrid, so a panel without a header still lines up.
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
  flush = false,
  stack,
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
  /** No box padding; the `ListRow`s inside carry `px-4`. */
  flush?: boolean;
  /** Stack the box's children in a flex column with this gap (× 4 px). */
  stack?: PanelStack;
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
          className={cn(
            'row-start-2 flex min-w-0 flex-1 flex-col',
            stack && stackClass[stack],
            boxClassName,
          )}
        >
          {children}
        </div>
      ) : (
        <div
          data-slot="panel-box"
          data-flush={flush || undefined}
          className={cn(
            panelBoxClass,
            'row-start-2',
            stack && stackClass[stack],
            flush && 'p-0 [&_[data-slot=list-row]]:px-4',
            boxClassName,
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}
