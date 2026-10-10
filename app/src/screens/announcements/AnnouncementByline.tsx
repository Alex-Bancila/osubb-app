import { MemberName } from '../../components/member/MemberName';
import type { MemberIdentity } from '../../components/member/member-identity';
import { cn } from '../../lib/utils';

/**
 * Who published it and when, on one muted line under a card's title:
 * "Ioana Popescu · 9 oct. · 22:03". The author is their Member Card button,
 * raised over the card's own tap target; with no author the line is the date.
 */
export function AnnouncementByline({
  author,
  publishedAt,
  publishedLabel,
  className,
}: {
  author: MemberIdentity | null;
  publishedAt: string;
  publishedLabel: string;
  className?: string;
}) {
  return (
    <div
      data-slot="announcement-byline"
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground',
        className,
      )}
    >
      {author && (
        <>
          <MemberName
            {...author}
            size="sm"
            // 44 px to a finger, without making the line 44 px tall.
            className="relative z-1 text-xs text-foreground pointer-coarse:-my-2.5"
          />
          <span aria-hidden="true">·</span>
        </>
      )}
      <time dateTime={publishedAt} className="shrink-0 tabular-nums">
        {publishedLabel}
      </time>
    </div>
  );
}

/**
 * A card's title as the button that opens it: its hit area is the whole card
 * (`after:inset-0` on the nearest positioned ancestor — the card), so anything
 * else to press inside must sit above it (`relative z-1`).
 */
export const cardOpenButtonClass =
  'cursor-pointer rounded-sm text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-solid focus-visible:after:outline-ring';
