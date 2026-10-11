import { CalendarClock, CalendarX2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { describeTermen, type TermenState } from './announcements-presentation';

/*
 * The Termen is a plain icon line, not another chip: a calendar-clock, the
 * word, the short date. Its tone says how near it is:
 *   upcoming  muted, as the rest of the card's meta;
 *   soon      (≤ 48 h) the destructive colour, heavier — the ask is about to
 *             close;
 *   expired   muted, a crossed calendar, "Termen expirat".
 */
const STATE_CLASS: Record<TermenState, string> = {
  upcoming: 'text-muted-foreground',
  soon: 'font-semibold text-destructive',
  expired: 'text-muted-foreground',
};

/** The Termen row of an Announcement (#909); nothing when it has none. */
export function AnnouncementTermen({
  deadline,
  className,
}: {
  deadline: string | null;
  className?: string;
}) {
  const termen = deadline ? describeTermen(deadline) : null;
  if (!deadline || !termen) return null;
  const Icon = termen.state === 'expired' ? CalendarX2 : CalendarClock;

  return (
    <p
      data-slot="announcement-termen"
      data-state={termen.state}
      className={cn(
        'm-0 flex max-w-full items-center gap-1.5 text-xs leading-tight',
        STATE_CLASS[termen.state],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-semibold">
        {termen.label}
        {termen.state === 'expired' ? ' ·' : ':'}
      </span>
      <time dateTime={deadline} className="min-w-0 truncate tabular-nums">
        {termen.when}
      </time>
    </p>
  );
}
