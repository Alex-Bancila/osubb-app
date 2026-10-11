import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck } from 'lucide-react';
import { cn } from 'cn';

/** How long a toast stays, and how long it takes to leave. */
const SHOWN_MS = 4000;
const LEAVING_MS = 180;

/**
 * A receipt that needs no place on the page (DESIGN.md, Receipts): one
 * sentence saying a command succeeded, floating above the tab bar for four
 * seconds, then gone. It is a `status`, so it is announced without taking
 * focus. For a receipt the member must be able to read later, or one that
 * names something to do next, keep the sentence on the page instead.
 *
 * Render it while the receipt stands and clear it in `onClose`.
 */
export function Toast({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const leave = window.setTimeout(() => setLeaving(true), SHOWN_MS);
    const close = window.setTimeout(onClose, SHOWN_MS + LEAVING_MS);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(close);
    };
    // The timer runs once per toast, whatever `onClose` is on later renders.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div
      data-slot="toast"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-80 flex justify-center px-4 lg:bottom-6"
    >
      <p
        role="status"
        className={cn(
          'pointer-events-auto m-0 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card py-2.5 pr-4 pl-3 text-sm font-medium text-foreground shadow-(--sh-md)',
          leaving ? 'motion-shrink' : 'motion-enter',
        )}
      >
        <CircleCheck
          aria-hidden="true"
          className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        />
        {children}
      </p>
    </div>,
    document.body,
  );
}
