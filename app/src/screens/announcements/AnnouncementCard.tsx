import { AttachedLinksList } from '../../components/attached-link/AttachedLinksList';
import { Card, CardContent } from '../../components/ui/card';
import { cn } from '../../lib/utils';
import { AnnouncementByline, cardOpenButtonClass } from './AnnouncementByline';
import { AnnouncementMeta } from './AnnouncementMeta';
import { AnnouncementTermen } from './AnnouncementTermen';
import type { AnnouncementPresentation } from './announcements-presentation';

type AnnouncementCardProps = {
  announcement: AnnouncementPresentation;
  onOpen: (announcement: AnnouncementPresentation) => void;
};

/**
 * One Announcement in the feed (layout N1, N2): the meta line, 12 px, the
 * title, the author and the date on one muted line under it, the Termen on
 * its own line when there is one (#909), 8 px, the body, then the links. The
 * whole card opens the Announcement — the title is the button, its hit area
 * the card — while the author and the links stay their own targets above it.
 */
export default function AnnouncementCard({
  announcement,
  onOpen,
}: AnnouncementCardProps) {
  const titleId = `announcement-title-${announcement.id}`;
  const isCritical = announcement.priority === 'critical';

  return (
    <Card
      role="article"
      aria-labelledby={titleId}
      className={cn(
        'relative transition-shadow hover:ring-foreground/25 motion-reduce:transition-none',
        isCritical &&
          'border-destructive/60 bg-destructive/5 dark:bg-destructive/10',
      )}
    >
      <CardContent>
        <AnnouncementMeta
          announcement={announcement}
          trailing={
            !announcement.isRead && (
              <span className="ml-auto inline-flex shrink-0 items-center pl-1">
                <span
                  className="size-2 rounded-full bg-destructive"
                  aria-hidden="true"
                />
                <span className="sr-only">Necitit</span>
              </span>
            )
          }
        />

        <h3 className="m-0 mt-3 font-heading text-base leading-snug font-semibold tracking-tight text-foreground sm:text-lg">
          <button
            type="button"
            data-slot="card-open"
            onClick={() => onOpen(announcement)}
            aria-label={`Citește anunțul ${announcement.title}`}
            className={cardOpenButtonClass}
          >
            <span id={titleId}>{announcement.title}</span>
          </button>
        </h3>
        <AnnouncementByline
          author={announcement.authorMember}
          publishedAt={announcement.publishedAt}
          publishedLabel={announcement.publishedLabel}
          className="mt-1"
        />

        <AnnouncementTermen deadline={announcement.deadline} className="mt-2" />

        <p className="m-0 mt-2 line-clamp-3 text-sm text-muted-foreground">
          {announcement.body}
        </p>

        <AttachedLinksList
          links={announcement.links}
          variant="card"
          className="mt-3"
          buttonClassName="relative z-1 max-w-full text-left wrap-anywhere"
        />
      </CardContent>
    </Card>
  );
}
