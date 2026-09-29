import { CalendarClock, CalendarX2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { describeTermen, type TermenState } from './announcements-presentation';

/*
 * The Termen reads as a ticket stub, not as another chip: a thick left bar,
 * square on the bar side, its own row. The Group is a solid pill, the priority
 * a rounded badge, the pin a bare icon, the date and author plain text — none
 * of them has a bar, so the Termen is told apart by shape before colour.
 *   upcoming  red bar on the red tint, the date in the text colour;
 *   soon      (≤ 48 h) filled brand red, black text — the loudest mark a card
 *             carries after Critic, because the ask is about to close;
 *   expired   grey bar on the muted fill, muted text, a crossed calendar.
 */
const STATE_CLASS: Record<TermenState, string> = {
  upcoming: 'border-primary bg-accent text-foreground',
  soon: 'border-brand-black bg-primary font-semibold text-primary-foreground',
  expired: 'border-border bg-muted text-muted-foreground',
};

const LABEL_CLASS: Record<TermenState, string> = {
  upcoming: 'text-accent-foreground',
  soon: '',
  expired: '',
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
        'm-0 inline-flex max-w-full items-center gap-1.5 rounded-sm rounded-l-none border-l-[3px] py-1 pr-2.5 pl-2 text-xs leading-tight',
        STATE_CLASS[termen.state],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className={cn('shrink-0 font-semibold', LABEL_CLASS[termen.state])}>
        {termen.label}
        {termen.state === 'expired' ? ' ·' : ':'}
      </span>
      <time dateTime={deadline} className="min-w-0 truncate tabular-nums">
        {termen.when}
      </time>
    </p>
  );
}
