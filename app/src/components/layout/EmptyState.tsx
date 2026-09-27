import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from 'cn';

/**
 * The vertical rhythm every in-box state shares — empty, loading and error —
 * so a box never jumps height between them.
 */
export const stateBoxClass =
  'flex flex-col items-center justify-center gap-3 py-8 text-center';

/**
 * The one empty state. Say what would be here ("Nu ai niciun task atribuit
 * încă."), never "Nicio informație".
 *
 * Rules:
 * - Centred, `py-8`, 14 px muted text, an optional 20 px icon and at most one
 *   action.
 * - Inside a box it has no border; on its own (`bare`) it gets a dashed one.
 */
export function EmptyState({
  children,
  icon: Icon,
  action,
  bare = false,
  role,
  className,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  bare?: boolean;
  /** `status` when the empty state answers something the member just did. */
  role?: 'status';
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      data-bare={bare || undefined}
      role={role}
      className={cn(
        stateBoxClass,
        bare && 'rounded-md border border-dashed border-border px-4',
        className,
      )}
    >
      {Icon && (
        <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
      )}
      <p className="m-0 max-w-sm text-sm text-balance text-muted-foreground">
        {children}
      </p>
      {action}
    </div>
  );
}
