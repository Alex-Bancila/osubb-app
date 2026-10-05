import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from 'cn';

import { Button } from '@/components/ui/button';

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

// The dim layer under every dialog (#943). It renders for a nested dialog too
// (`forceRender`: Base UI hides a nested backdrop by default), and it shares
// the popup's `z-70`: layers then stack in the order they open, so a dialog
// opened from a sheet dims the sheet beneath it, not only the page. Base UI
// keeps focus in the top layer and Escape closes only that layer.
function DialogOverlay({
  className,
  forceRender = true,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      forceRender={forceRender}
      className={cn(
        'fixed inset-0 z-70 bg-black/40 transition-opacity motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

// A small, centred pop-up: the place for a quick decision that should not
// cost the member a whole page. Base UI traps focus inside it and hands focus
// back to the trigger when it closes. It centres in, and never outgrows, the
// area above a phone keyboard (#1013): `--visible-height` is the whole screen
// otherwise, and a dialog taller than that scrolls inside itself.
function DialogContent({
  className,
  children,
  showCloseButton = true,
  fullScreenOnPhone = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  /**
   * A form too long for a pop-up (Task nou, Eveniment nou, an approval): the
   * whole screen above the keyboard under `sm`, a centred dialog from `sm`.
   */
  fullScreenOnPhone?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-[calc((100%-var(--keyboard-inset))/2)] left-1/2 z-70 grid max-h-[calc(var(--visible-height)-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl bg-card p-4 text-sm text-card-foreground shadow-xl ring-1 ring-foreground/10 outline-none transition-[opacity,scale] motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 sm:max-w-md',
          fullScreenOnPhone &&
            'max-sm:top-0 max-sm:left-0 max-sm:h-(--visible-height) max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label="Închide"
            render={
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1 right-1"
              />
            }
          >
            <XIcon aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

// One header for every dialog and sheet (#842, X11): a 19 px bold title, a
// 14 px muted description under it, and room on the right for the 44 px X.
function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5 pr-10', className)}
      {...props}
    />
  );
}

// One footer for every dialog and sheet (#842, X11): put the secondary action
// first and the primary last. From `sm` they sit right-aligned in a row with
// the primary on the right; under `sm` they stack full-width with the
// primary on top, nearest the thumb. While a phone keyboard is open it sticks
// just above the keyboard (#1013).
function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      data-keyboard-pin=""
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

// 19 px bold (`--fs-lg`). `m-0` because the title is an `h2`, and the
// unlayered heading reset in global.css gives every `h2` an 18 px top margin
// that would push the title below the X.
function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        'm-0 font-heading text-(length:--fs-lg) leading-snug font-bold',
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
