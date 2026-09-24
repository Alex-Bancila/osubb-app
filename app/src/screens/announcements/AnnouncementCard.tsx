import {
  AlertTriangle,
  ChevronRight,
  Pin,
  Star,
  UserRound,
} from 'lucide-react';
import { AttachedLinkButton } from '../../components/attached-link/AttachedLinkButton';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '../../components/ui/card';
import { cn } from '../../lib/utils';
import {
  priorityMeta,
  type AnnouncementPresentation,
} from './announcements-presentation';

type AnnouncementCardProps = {
  announcement: AnnouncementPresentation;
  onOpen: (announcement: AnnouncementPresentation) => void;
};

export default function AnnouncementCard({
  announcement,
  onOpen,
}: AnnouncementCardProps) {
  const meta = priorityMeta(announcement.priority);
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
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {announcement.pinned && (
              <Badge variant="secondary" className="gap-1">
                <Pin className="size-3" aria-hidden="true" />
                <span>Fixat</span>
              </Badge>
            )}

            <Badge variant={meta.variant} className="gap-1">
              {isCritical ? (
                <AlertTriangle className="size-3" aria-hidden="true" />
              ) : announcement.priority === 'important' ? (
                <Star className="size-3" aria-hidden="true" />
              ) : null}
              <span>{meta.label}</span>
            </Badge>

            <span
              className={cn(
                'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold',
                announcement.group.color
                  ? 'text-white'
                  : 'bg-muted text-muted-foreground',
              )}
              style={
                announcement.group.color
                  ? { backgroundColor: announcement.group.color }
                  : undefined
              }
            >
              {announcement.group.short ?? announcement.group.name}
            </span>
            <Badge variant="outline">{announcement.audienceLabel}</Badge>

            {announcement.category && (
              <Badge variant="outline" className="text-muted-foreground">
                {announcement.category}
              </Badge>
            )}
          </div>

          {!announcement.isRead && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <span
                className="size-2 rounded-full bg-destructive"
                aria-hidden="true"
              />
              Necitit
            </span>
          )}
        </div>

        <h3
          id={titleId}
          className="font-heading text-base font-semibold leading-snug tracking-tight text-foreground sm:text-lg"
        >
          {announcement.title}
        </h3>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="line-clamp-3 text-sm text-muted-foreground">
          {announcement.body}
        </p>

        {announcement.formLabel && announcement.formUrl && (
          <div className="pt-1">
            <AttachedLinkButton
              label={announcement.formLabel}
              url={announcement.formUrl}
            />
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          {announcement.author && (
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <UserRound className="size-3.5" aria-hidden="true" />
              {announcement.author}
            </span>
          )}
          <span>·</span>
          <time dateTime={announcement.publishedAt}>
            {announcement.publishedLabel}
          </time>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpen(announcement)}
          className="min-h-11 gap-1 text-xs text-primary"
        >
          <span>Citește</span>
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Button>
      </CardFooter>
    </Card>
  );
}
