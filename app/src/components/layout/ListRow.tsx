import { type ReactNode } from 'react';
import { cn } from 'cn';

/**
 * The list a `ListRow` sits in: no bullets, a soft rule between rows. Put it
 * on the `ul`/`ol`.
 */
export const rowListClass = 'm-0 list-none divide-y divide-(--border-soft) p-0';

/**
 * The column template for the cells a row has, so an absent value or action
 * leaves no empty gap. Static strings, so Tailwind sees every one.
 */
const templates: Record<string, string> = {
  '111': 'grid-cols-[2.5rem_minmax(0,1fr)_auto_auto]',
  '110': 'grid-cols-[2.5rem_minmax(0,1fr)_auto]',
  '101': 'grid-cols-[2.5rem_minmax(0,1fr)_auto]',
  '100': 'grid-cols-[2.5rem_minmax(0,1fr)]',
  '011': 'grid-cols-[minmax(0,1fr)_auto_auto]',
  '010': 'grid-cols-[minmax(0,1fr)_auto]',
  '001': 'grid-cols-[minmax(0,1fr)_auto]',
  '000': 'grid-cols-[minmax(0,1fr)]',
};

/**
 * One list row, everywhere a list of people, Campaigns or notifications
 * appears.
 *
 * Rules:
 * - At least 56 px tall (`min-h-14`), `px-3 py-2`, 12 px between columns.
 * - Columns: leading (2.5 rem — a rank, an avatar, an icon) · body · value ·
 *   action; a row without one of them has no column for it. The value is
 *   `tabular-nums`, right-aligned.
 * - `mine` marks the viewer's own row (`bg-primary/5 ring-1 ring-primary/30`).
 * - `stackAction` moves the action under the body below 640 px, for rows whose
 *   action is several buttons — nothing may scroll sideways at 375 px.
 * - `footer` spans the whole row under it (an expanded report).
 */
export function ListRow({
  leading,
  children,
  value,
  action,
  footer,
  mine = false,
  stackAction = false,
  as: Element = 'li',
  className,
  id,
}: {
  leading?: ReactNode;
  children: ReactNode;
  value?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  mine?: boolean;
  stackAction?: boolean;
  as?: 'li' | 'div';
  className?: string;
  id?: string;
}) {
  const has = (node: ReactNode) => (node != null && node !== false ? 1 : 0);
  const template = templates[`${has(leading)}${has(value)}${has(action)}`];
  return (
    <Element
      id={id}
      data-slot="list-row"
      data-mine={mine || undefined}
      className={cn(
        'grid min-h-14 items-center gap-3 px-3 py-2',
        template,
        mine && 'rounded-sm bg-primary/5 ring-1 ring-primary/30',
        className,
      )}
    >
      {has(leading) > 0 && (
        <div data-slot="list-row-leading" className="flex justify-center">
          {leading}
        </div>
      )}
      <div data-slot="list-row-body" className="min-w-0">
        {children}
      </div>
      {has(value) > 0 && (
        <div
          data-slot="list-row-value"
          className="text-right whitespace-nowrap tabular-nums"
        >
          {value}
        </div>
      )}
      {has(action) > 0 && (
        <div
          data-slot="list-row-action"
          className={cn(
            'flex min-w-0 flex-wrap items-center justify-end gap-2',
            stackAction && 'max-sm:col-span-full max-sm:justify-start',
          )}
        >
          {action}
        </div>
      )}
      {has(footer) > 0 && (
        <div data-slot="list-row-footer" className="col-span-full min-w-0">
          {footer}
        </div>
      )}
    </Element>
  );
}
