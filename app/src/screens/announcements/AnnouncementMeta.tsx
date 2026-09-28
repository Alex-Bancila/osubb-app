import type { ReactNode } from 'react';
import { AlertTriangle, Pin, Star } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { cn } from '../../lib/utils';
import {
  originLabel,
  priorityMeta,
  showsPriority,
  type AnnouncementPresentation,
} from './announcements-presentation';

/**
 * The one meta line of an Announcement (B34, layout N1): a pin when it is
 * pinned, the priority only when it is Important or Critic, the Origin by the
 * Group's name, and the Audience only when it is local ("Doar Educațional").
 * `trailing` closes the line (the unread dot on a card, the read state in the
 * details sheet). One line: the Group name and the Audience truncate before
 * the line wraps.
 */
export function AnnouncementMeta({
  announcement,
  trailing,
  className,
}: {
  announcement: AnnouncementPresentation;
  trailing?: ReactNode;
  className?: string;
}) {
  const meta = priorityMeta(announcement.priority);
  const isCritical = announcement.priority === 'critical';

  return (
    <div
      data-slot="announcement-meta"
      className={cn('flex min-w-0 items-center gap-2', className)}
    >
      {announcement.pinned && (
        <span
          title="Fixat"
          className="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground"
        >
          <Pin className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Fixat</span>
        </span>
      )}

      {showsPriority(announcement.priority) && (
        <Badge variant={meta.variant} className="shrink-0 gap-1">
          {isCritical ? (
            <AlertTriangle className="size-3" aria-hidden="true" />
          ) : (
            <Star className="size-3" aria-hidden="true" />
          )}
          <span>{meta.label}</span>
        </Badge>
      )}

      <span
        className={cn(
          'inline-block min-w-0 truncate rounded-md px-2 py-0.5 text-xs font-semibold',
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
        {originLabel(announcement.group)}
      </span>

      {announcement.audienceLabel && (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {announcement.audienceLabel}
        </span>
      )}

      {trailing}
    </div>
  );
}
