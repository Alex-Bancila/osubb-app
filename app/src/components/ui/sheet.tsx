import { Dialog } from '@base-ui/react/dialog';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

function Sheet(props: ComponentProps<typeof Dialog.Root>) {
  return <Dialog.Root {...props} />;
}

function SheetTrigger(props: ComponentProps<typeof Dialog.Trigger>) {
  return <Dialog.Trigger {...props} />;
}

function SheetPortal(props: ComponentProps<typeof Dialog.Portal>) {
  return <Dialog.Portal {...props} />;
}

function SheetBackdrop({
  className,
  ...props
}: ComponentProps<typeof Dialog.Backdrop>) {
  return (
    <Dialog.Backdrop
      className={cn(
        'fixed inset-0 z-60 bg-black/40 data-ending-style:opacity-0 data-starting-style:opacity-0 transition-opacity motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  );
}

function SheetPopup({
  className,
  ...props
}: ComponentProps<typeof Dialog.Popup>) {
  return (
    <Dialog.Popup
      className={cn(
        'fixed inset-y-0 left-0 z-70 flex w-[min(280px,calc(100%-2rem))] flex-col bg-card shadow-xl outline-none transition-transform motion-reduce:transition-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full',
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle(props: ComponentProps<typeof Dialog.Title>) {
  return <Dialog.Title {...props} />;
}

function SheetClose(props: ComponentProps<typeof Dialog.Close>) {
  return <Dialog.Close {...props} />;
}

export {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetPopup,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
