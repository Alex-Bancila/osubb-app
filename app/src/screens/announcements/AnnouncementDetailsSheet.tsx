import { ExternalLink, UserRound } from 'lucide-react';
import { EmptyState } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { Badge } from '../../components/ui/badge';
import {
  Sheet,
  SheetBackdrop,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../components/ui/sheet';
import { safeHttpUrl } from '../../lib/links';
import { AnnouncementMeta } from './AnnouncementMeta';
import type { AnnouncementPresentation } from './announcements-presentation';
import AnnouncementReaders from './AnnouncementReaders';

type AnnouncementDetailsSheetProps = {
  announcement: AnnouncementPresentation | null;
  /**
   * A `?anunt=` link to an Announcement the member cannot read (deleted, or
   * outside their Audience): the sheet opens and says so.
   */
  unavailable?: boolean;
  onClose: () => void;
};

export default function AnnouncementDetailsSheet({
  announcement,
  unavailable = false,
  onClose,
}: AnnouncementDetailsSheetProps) {
  if (!announcement && !unavailable) return null;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup side="right" className="max-w-2xl gap-5 p-4 sm:p-6">
          {announcement ? (
            <AnnouncementDetails announcement={announcement} />
          ) : (
            <>
              <SheetHeader>
                <SheetTitle>Anunț indisponibil</SheetTitle>
                <SheetDescription className="sr-only">
                  Anunțul din link nu poate fi deschis.
                </SheetDescription>
              </SheetHeader>
              <EmptyState bare>
                Acest anunț nu mai există sau nu îți este adresat.
              </EmptyState>
            </>
          )}
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}

function AnnouncementDetails({
  announcement,
}: {
  announcement: AnnouncementPresentation;
}) {
  // The Attached Link rule (`safeHttpUrl`): a legacy row that is not http(s)
  // renders no form link rather than an href the server never checked.
  const formUrl = safeHttpUrl(announcement.formUrl);

  return (
    <>
      <SheetHeader>
        <AnnouncementMeta
          announcement={announcement}
          className="flex-wrap"
          // No read state here: opening the sheet is what marks it read.
          trailing={
            announcement.category && (
              <Badge variant="outline">{announcement.category}</Badge>
            )
          }
        />
        <SheetTitle className="mt-1.5">{announcement.title}</SheetTitle>
        {/* As on the card: the date under the title, then the author. */}
        <SheetDescription className="-mt-1 text-xs">
          <time dateTime={announcement.publishedAt}>
            {announcement.publishedLabel}
          </time>
        </SheetDescription>
        <div className="-my-1.5 flex min-w-0 items-center text-xs">
          {announcement.authorMember ? (
            <MemberName
              {...announcement.authorMember}
              size="sm"
              className="min-h-11 text-xs"
            />
          ) : (
            <span className="inline-flex min-h-11 items-center gap-1 font-medium text-foreground">
              <UserRound className="size-3.5" aria-hidden="true" />
              {announcement.author ?? 'OSUBB'}
            </span>
          )}
        </div>
      </SheetHeader>

      <div className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">
        {announcement.body}
      </div>

      {announcement.formLabel && formUrl && (
        <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-4">
          <p className="m-0 text-xs font-semibold text-primary">
            Formular asociat
          </p>
          <a
            href={formUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span>Deschide formular: {announcement.formLabel}</span>
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </div>
      )}

      <AnnouncementReaders announcement={announcement} />
    </>
  );
}
