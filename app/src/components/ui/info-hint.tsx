import { Popover } from '@base-ui/react/popover';
import { InfoIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from 'cn';

import { Button } from '@/components/ui/button';

/**
 * The small "i" beside a label: a short explanation in a pop-over, for the
 * sentence a field needs once and never again. It opens on a tap or a click,
 * closes on Escape or a tap outside, and sits above a dialog or a sheet.
 *
 * The same text stays in the page, hidden, under `id`: point the field's
 * `aria-describedby` at it and a screen reader hears the explanation without
 * opening anything. The button is a 44 px target that adds no height to the
 * label's row.
 *
 * Keep it to a sentence or two. Anything a member must read before acting
 * belongs on the page, not behind an icon.
 */
export function InfoHint({
  label,
  id,
  children,
  className,
}: {
  /** The button's accessible name ("Despre campanie"). */
  label: string;
  /** The id of the hidden copy, for the field's `aria-describedby`. */
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <Popover.Root>
        <Popover.Trigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn('-my-3 text-muted-foreground', className)}
            />
          }
          aria-label={label}
          data-slot="info-hint"
        >
          <InfoIcon aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="z-80 outline-none"
          >
            <Popover.Popup
              aria-label={label}
              className="max-w-[min(20rem,calc(100vw-1.5rem))] origin-(--transform-origin) rounded-lg bg-popover p-3 text-sm leading-relaxed text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale] outline-none motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
            >
              {children}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {id && (
        <span id={id} hidden>
          {children}
        </span>
      )}
    </>
  );
}
