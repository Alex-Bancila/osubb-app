import { ChevronDownIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from 'cn';

/**
 * A row that opens to show more (a Task's history, a guide's section): a
 * native `details`, so it works without script and a screen reader says
 * "collapsed"/"expanded", drawn as one 44 px row whose chevron turns. The
 * browser's own triangle is hidden.
 */
export function Disclosure({
  summary,
  children,
  className,
  summaryClassName,
  ...props
}: Omit<ComponentProps<'details'>, 'children'> & {
  summary: ReactNode;
  children: ReactNode;
  summaryClassName?: string;
}) {
  return (
    <details
      data-slot="disclosure"
      className={cn('group/disclosure', className)}
      {...props}
    >
      <summary
        className={cn(
          'flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring [&::-webkit-details-marker]:hidden',
          summaryClassName,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">{summary}</span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open/disclosure:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      {children}
    </details>
  );
}
