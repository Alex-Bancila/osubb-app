import type { ComponentProps, ReactNode } from 'react';
import { cn } from 'cn';

import {
  Sheet,
  SheetBackdrop,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * The one surface a create or edit form opens in (DESIGN.md, "Four surfaces,
 * each with one job"): a panel from the right on a desktop, rising from the
 * bottom to the form's height on a phone, titled by what it makes ("Task
 * nou"). No intro paragraph: what a field needs explained sits behind its
 * `InfoHint`. End the form with `FormSheetFooter`.
 *
 * `busy` (a save is running) keeps the sheet open: no close button, and
 * Escape or a tap outside do nothing. A dialog is for a confirmation or a
 * reason, not a form.
 */
export function FormSheet({
  open,
  onOpenChange,
  title,
  busy = false,
  children,
  className,
  ...popup
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  busy?: boolean;
  children: ReactNode;
  className?: string;
} & Pick<ComponentProps<typeof SheetPopup>, 'finalFocus' | 'initialFocus'>) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup
          side="bottom"
          data-slot="form-sheet"
          aria-describedby={undefined}
          className={cn('gap-5 p-4 sm:max-w-xl sm:p-6', className)}
          {...popup}
        >
          <SheetHeader showCloseButton={!busy}>
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          {children}
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}

/**
 * A form sheet's actions, always in view: the secondary (Renunță) first, a
 * third of the row; the primary last, two thirds.
 */
export function FormSheetFooter(
  props: Omit<ComponentProps<typeof SheetFooter>, 'pinned'>,
) {
  return <SheetFooter pinned {...props} />;
}
