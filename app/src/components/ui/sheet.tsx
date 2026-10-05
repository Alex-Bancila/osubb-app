import { Dialog } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

import { Button } from '@/components/ui/button';

function Sheet(props: ComponentProps<typeof Dialog.Root>) {
  return <Dialog.Root {...props} />;
}

function SheetTrigger(props: ComponentProps<typeof Dialog.Trigger>) {
  return <Dialog.Trigger {...props} />;
}

function SheetPortal(props: ComponentProps<typeof Dialog.Portal>) {
  return <Dialog.Portal {...props} />;
}

// The same dim layer as a dialog's (#943): it renders for a nested sheet too
// and shares the popup's `z-70`, so a sheet or dialog opened from a sheet
// dims the sheet beneath it.
function SheetBackdrop({
  className,
  forceRender = true,
  ...props
}: ComponentProps<typeof Dialog.Backdrop>) {
  return (
    <Dialog.Backdrop
      data-slot="sheet-backdrop"
      forceRender={forceRender}
      className={cn(
        'fixed inset-0 z-70 bg-black/40 data-ending-style:opacity-0 data-starting-style:opacity-0 transition-opacity motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  );
}

// Both sides fill the area a phone keyboard leaves visible (#1013), from
// where iOS panned it to down to the keyboard: the sheet's own
// scroll then reaches every field, and its footer pins above the keyboard.
const sheetSides = {
  // The navigation drawer: narrow, from the left.
  left: 'top-(--visible-top) bottom-(--keyboard-inset) left-0 w-[min(280px,calc(100%-2rem))] data-ending-style:-translate-x-full data-starting-style:-translate-x-full',
  // A details or form panel: the full width of a phone, from the right, and
  // slides in and out on that side. Set the width cap (`max-w-md`, …) and the
  // padding at the call site.
  right:
    'top-(--visible-top) bottom-(--keyboard-inset) right-0 w-full overflow-y-auto data-ending-style:translate-x-full data-starting-style:translate-x-full',
} as const;

function SheetPopup({
  className,
  side = 'left',
  ...props
}: ComponentProps<typeof Dialog.Popup> & {
  /** Which edge the sheet slides from. `left` (the default) is the drawer. */
  side?: keyof typeof sheetSides;
}) {
  return (
    <Dialog.Popup
      data-slot="sheet-content"
      data-side={side}
      className={cn(
        'fixed z-70 flex flex-col bg-card shadow-xl outline-none transition-transform motion-reduce:transition-none',
        sheetSides[side],
        className,
      )}
      {...props}
    />
  );
}

// The same header as a dialog (#842, X11): the title (19 px bold) and an
// optional description on the left, and the 44 px X icon button named
// "Închide" on the right. Pass `showCloseButton={false}` when the sheet must
// not close from its header (for example while a save is running).
function SheetHeader({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<'div'> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex items-start justify-between gap-3', className)}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-2">
        {children}
      </div>
      {showCloseButton && <SheetCloseButton className="-mr-2 shrink-0" />}
    </div>
  );
}

// The X on its own, for a header the call site lays out itself.
function SheetCloseButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Dialog.Close>, 'children' | 'render'>) {
  return (
    <Dialog.Close
      data-slot="sheet-close"
      aria-label="Închide"
      render={<Button variant="ghost" size="icon" className={className} />}
      {...props}
    >
      <XIcon aria-hidden="true" />
    </Dialog.Close>
  );
}

function SheetTitle({
  className,
  ...props
}: ComponentProps<typeof Dialog.Title>) {
  return (
    <Dialog.Title
      data-slot="sheet-title"
      className={cn(
        'm-0 font-heading text-(length:--fs-lg) leading-snug font-bold',
        className,
      )}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof Dialog.Description>) {
  return (
    <Dialog.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

// The same footer as a dialog (#842, X11): secondary first, primary last;
// a right-aligned row from `sm`, a full-width stack with the primary on top
// under `sm`. `mt-auto` keeps it at the bottom of a short sheet. While a
// phone keyboard is open it sticks just above the keyboard (#1013).
function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      data-keyboard-pin=""
      className={cn(
        'mt-auto flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

function SheetClose(props: ComponentProps<typeof Dialog.Close>) {
  return <Dialog.Close {...props} />;
}

export {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetCloseButton,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
