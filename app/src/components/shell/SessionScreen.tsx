import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import logoDark from '../../assets/brand/osubb-logo-on-dark.png';
import logoLight from '../../assets/brand/osubb-logo-on-light.png';
import { cn } from '../../lib/utils';
import { Card, CardContent } from '../ui/card';

function SessionScreen({
  children,
  centered = false,
  wide = false,
  footer,
}: {
  children: ReactNode;
  centered?: boolean;
  /** A reading width for long text — the Privacy Notice (#771). */
  wide?: boolean;
  /** Small print under the card, such as the Privacy Notice link. */
  footer?: ReactNode;
}) {
  return (
    <main
      className={cn(
        'h-(--visible-height) overflow-y-auto bg-background px-4 keyboard:scroll-pb-3 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]',
        // A card sits in the middle of the screen at every width (#844,
        // layout S1). `place-items`, not `place-content`: a card taller than
        // the screen grows its row and scrolls from its top, never clipped.
        // The reading-width Notice keeps a top start: it is read, not met.
        wide ? 'sm:pt-[min(12vh,6rem)]' : 'grid place-items-center',
      )}
    >
      <div className="w-full">
        <Card
          className={cn(
            'mx-auto shadow-md',
            wide
              ? 'max-w-[40rem] sm:[--card-spacing:--spacing(8)]'
              : 'max-w-md',
          )}
        >
          <CardContent
            className={cn(
              'flex flex-col gap-4',
              centered && 'items-center text-center',
            )}
          >
            <img
              className={cn(
                'h-12 w-auto object-contain dark:hidden',
                centered ? 'self-center' : 'self-start',
              )}
              src={logoLight}
              alt="OSUBB"
            />
            <img
              className={cn(
                'hidden h-12 w-auto object-contain dark:block',
                centered ? 'self-center' : 'self-start',
              )}
              src={logoDark}
              alt="OSUBB"
            />
            {children}
          </CardContent>
        </Card>
        {footer && (
          <footer
            className={cn(
              'mx-auto mt-4 text-center text-sm text-muted-foreground',
              wide ? 'max-w-[40rem]' : 'max-w-md',
            )}
          >
            {footer}
          </footer>
        )}
      </div>
    </main>
  );
}

function SessionLoader({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-2 text-sm text-muted-foreground"
      role="status"
      aria-label={label}
    >
      <LoaderCircle
        className="size-5 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}

export { SessionLoader, SessionScreen };
