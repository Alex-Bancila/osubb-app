import type { ReactNode } from 'react';
import { CheckIcon } from 'lucide-react';
import { focusRingClass } from '../../../components/layout/focus';
import { cn } from '../../../lib/utils';
import type { GuidePatch } from './selection';

/**
 * A guide row's Setează: writes `patch` into the open form. The button whose
 * values the form holds now is marked (a red outline and a check), so the
 * guide shows what is set without a second look at the form. The accessible
 * `name` always starts with "Setează" and names the row.
 */
export function SetButton({
  name,
  patch,
  applied,
  onSet,
  children,
  className,
}: {
  name: string;
  patch: GuidePatch;
  applied: boolean;
  onSet: (patch: GuidePatch) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      data-applied={applied || undefined}
      onClick={() => onSet(patch)}
      className={cn(
        'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm font-semibold whitespace-nowrap text-foreground hover:border-foreground/40 hover:bg-muted data-applied:border-brand-red data-applied:bg-accent data-applied:text-accent-foreground',
        focusRingClass,
        className,
      )}
    >
      {children}
      {applied && <CheckIcon aria-hidden="true" className="size-4" />}
    </button>
  );
}
