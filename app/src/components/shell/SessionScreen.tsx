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
    <main className="h-dvh overflow-y-auto bg-background px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:pt-[min(12vh,6rem)]">
      <Card
        className={cn('mx-auto shadow-md', wide ? 'max-w-3xl' : 'max-w-md')}
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
            wide ? 'max-w-3xl' : 'max-w-md',
          )}
        >
          {footer}
        </footer>
      )}
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
