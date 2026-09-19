import { AlertTriangle } from 'lucide-react';
import { Button } from '../../components/ui/button';
import type { AnnouncementPresentation } from './announcements-presentation';

type CriticalAnnouncementBannerProps = {
  announcement: AnnouncementPresentation | null;
  onOpen: (announcement: AnnouncementPresentation) => void;
};

export default function CriticalAnnouncementBanner({
  announcement,
  onOpen,
}: CriticalAnnouncementBannerProps) {
  if (
    !announcement ||
    announcement.isRead ||
    announcement.priority !== 'critical'
  ) {
    return null;
  }

  return (
    <div
      role="alert"
      tabIndex={0}
      onClick={() => onOpen(announcement)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(announcement);
        }
      }}
      className="mb-6 flex cursor-pointer flex-col gap-3 rounded-xl border border-destructive/60 bg-destructive/10 p-4 text-destructive shadow-sm transition-colors hover:bg-destructive/15 focus-visible:outline-2 focus-visible:outline-ring sm:flex-row sm:items-center sm:justify-between sm:p-5"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 size-5 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="font-heading font-semibold text-destructive">
            Anunț critic: {announcement.title}
          </p>
          <p className="line-clamp-2 text-sm text-destructive/90">
            {announcement.body}
          </p>
        </div>
      </div>

      <Button
        variant="destructive"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(announcement);
        }}
        className="min-h-11 shrink-0 self-start sm:self-center"
      >
        Citește acum
      </Button>
    </div>
  );
}
