import { ChevronRight, UserRound } from 'lucide-react';
import { AttachedLinkButton } from '../../components/attached-link/AttachedLinkButton';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardFooter } from '../../components/ui/card';
import { cn } from '../../lib/utils';
import { AnnouncementMeta } from './AnnouncementMeta';
import { AnnouncementTermen } from './AnnouncementTermen';
import type { AnnouncementPresentation } from './announcements-presentation';

type AnnouncementCardProps = {
  announcement: AnnouncementPresentation;
  onOpen: (announcement: AnnouncementPresentation) => void;
};

/**
 * One Announcement in the feed (layout N1, N2): the meta line, 12 px, the
 * title with its date under it, the Termen on its own row when there is one
 * (#909), 8 px, the body, 16 px, and a one-row footer — the author on the
 * left, "Citește" on the right.
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

        <h3
          id={titleId}
          className="m-0 mt-3 font-heading text-base leading-snug font-semibold tracking-tight text-foreground sm:text-lg"
        >
          {announcement.title}
        </h3>
        <time
          dateTime={announcement.publishedAt}
          className="mt-0.5 block text-xs text-muted-foreground"
        >
          {announcement.publishedLabel}
        </time>

        <AnnouncementTermen deadline={announcement.deadline} className="mt-2" />

        <p className="m-0 mt-2 line-clamp-3 text-sm text-muted-foreground">
          {announcement.body}
        </p>

        {announcement.formLabel && announcement.formUrl && (
          <div className="mt-3">
            <AttachedLinkButton
              label={announcement.formLabel}
              url={announcement.formUrl}
            />
          </div>
        )}
      </CardContent>

      <CardFooter className="justify-between gap-3 py-3 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center pointer-coarse:-my-1.5">
          {announcement.authorMember ? (
            <MemberName
              {...announcement.authorMember}
              size="sm"
              className="text-xs text-foreground"
            />
          ) : (
            announcement.author && (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <UserRound className="size-3.5" aria-hidden="true" />
                {announcement.author}
              </span>
            )
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpen(announcement)}
          className="-my-1.5 -mr-2 min-h-11 shrink-0 gap-1 text-xs text-primary"
        >
          <span>Citește</span>
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Button>
      </CardFooter>
    </Card>
  );
}
