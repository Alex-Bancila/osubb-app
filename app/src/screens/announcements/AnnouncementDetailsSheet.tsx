import {
  AlertTriangle,
  Check,
  ExternalLink,
  Pin,
  Star,
  UserRound,
  Calendar,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../components/ui/sheet';
import { cn } from '../../lib/utils';
import {
  priorityMeta,
  type AnnouncementPresentation,
} from './announcements-presentation';

type AnnouncementDetailsSheetProps = {
  announcement: AnnouncementPresentation | null;
  onClose: () => void;
};

export default function AnnouncementDetailsSheet({
  announcement,
  onClose,
}: AnnouncementDetailsSheetProps) {
  if (!announcement) return null;

  const meta = priorityMeta(announcement.priority);
  const isCritical = announcement.priority === 'critical';

  return (
    <Sheet
      open={announcement !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup
          className="right-0 left-auto w-full max-w-2xl overflow-y-auto p-4 sm:p-6"
          aria-describedby={undefined}
        >
          <div className="mb-5 flex items-center justify-between gap-3 border-b pb-4">
            <SheetTitle className="font-heading text-xl font-semibold">
              Detalii anunț
            </SheetTitle>
            <SheetClose className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-input px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              Închide
            </SheetClose>
          </div>

          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
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

              {announcement.department ? (
                <span
                  className={cn(
                    'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold',
                    announcement.department.color
                      ? 'text-white'
                      : 'bg-muted text-muted-foreground',
                  )}
                  style={
                    announcement.department.color
                      ? { backgroundColor: announcement.department.color }
                      : undefined
                  }
                >
                  {announcement.department.name}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  OSUBB
                </span>
              )}

              {announcement.category && (
                <Badge variant="outline">{announcement.category}</Badge>
              )}

              {announcement.isRead ? (
                <Badge
                  variant="secondary"
                  className="gap-1 text-emerald-600 dark:text-emerald-400"
                >
                  <Check className="size-3" aria-hidden="true" />
                  <span>Citit</span>
                </Badge>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-destructive">
                  <span
                    className="size-2 rounded-full bg-destructive"
                    aria-hidden="true"
                  />
                  Necitit
                </span>
              )}
            </div>

            <div className="space-y-2">
              <h2 className="font-heading text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {announcement.title}
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/40 p-4 text-xs sm:grid-cols-2">
              <div className="flex items-center gap-2 text-muted-foreground">
                <UserRound
                  className="size-4 text-foreground"
                  aria-hidden="true"
                />
                <div>
                  <span className="block font-medium text-foreground">
                    Autor
                  </span>
                  <span>{announcement.author ?? 'OSUBB'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar
                  className="size-4 text-foreground"
                  aria-hidden="true"
                />
                <div>
                  <span className="block font-medium text-foreground">
                    Publicat
                  </span>
                  <time dateTime={announcement.publishedAt}>
                    {announcement.publishedLabel}
                  </time>
                </div>
              </div>
            </div>

            <div className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">
              {announcement.body}
            </div>

            {announcement.formLabel && announcement.formUrl && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="mb-2 text-xs font-semibold text-primary">
                  Formular asociat
                </div>
                <a
                  href={announcement.formUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span>Deschide formular: {announcement.formLabel}</span>
                  <ExternalLink className="size-4" aria-hidden="true" />
                </a>
              </div>
            )}
          </div>
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}
