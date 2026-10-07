import { useState } from 'react';
import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { AttachedLinksList } from '../../components/attached-link/AttachedLinksList';
import { EmptyState } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Sheet,
  SheetBackdrop,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../components/ui/sheet';
import { useCapability } from '../../lib/capabilities';
import {
  isAnnouncementRefusal,
  useDeleteAnnouncement,
  useSetAnnouncementPinned,
} from '../../queries/announcements';
import { useMyGroupRoles } from '../../queries/my-groups';
import AnnouncementEditSheet from './AnnouncementEditSheet';
import { AnnouncementMeta } from './AnnouncementMeta';
import { AnnouncementTermen } from './AnnouncementTermen';
import {
  mayManageAnnouncement,
  type AnnouncementPresentation,
} from './announcements-presentation';
import AnnouncementReaders from './AnnouncementReaders';

type AnnouncementDetailsSheetProps = {
  announcement: AnnouncementPresentation | null;
  /**
   * A `?anunt=` link to an Announcement the member cannot read (deleted, or
   * outside their Audience): the sheet opens and says so.
   */
  unavailable?: boolean;
  onClose: () => void;
  /**
   * The Announcement was deleted from this sheet (#930); the screen closes it
   * and says so. Closing is the default.
   */
  onDeleted?: () => void;
};

export default function AnnouncementDetailsSheet({
  announcement,
  unavailable = false,
  onClose,
  onDeleted = onClose,
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
            <AnnouncementDetails
              announcement={announcement}
              onDeleted={onDeleted}
            />
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
  onDeleted,
}: {
  announcement: AnnouncementPresentation;
  onDeleted: () => void;
}) {
  return (
    <>
      <SheetHeader>
        <AnnouncementMeta
          announcement={announcement}
          className="flex-wrap"
          // No read state here: opening the sheet is what marks it read.
        />
        <SheetTitle className="mt-1.5">{announcement.title}</SheetTitle>
        {/* As on the card: the date under the title, then the author. */}
        <SheetDescription className="-mt-1 text-xs">
          <time dateTime={announcement.publishedAt}>
            {announcement.publishedLabel}
          </time>
        </SheetDescription>
        <AnnouncementTermen
          deadline={announcement.deadline}
          className="self-start"
        />
        <div className="flex min-w-0 items-center text-xs pointer-coarse:-my-1.5">
          {announcement.authorMember && (
            <MemberName
              {...announcement.authorMember}
              size="sm"
              className="text-xs"
            />
          )}
        </div>
      </SheetHeader>

      <div className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">
        {announcement.body}
      </div>

      {/* R46: each link reads "Deschide: <etichetă>" here; the list drops
          any address that is not http(s) (`safeHttpUrl`). */}
      <AttachedLinksList
        links={announcement.links}
        variant="details"
        buttonClassName="max-w-full text-left wrap-anywhere"
      />

      <AnnouncementReaders announcement={announcement} />

      <AnnouncementManageActions
        key={announcement.id}
        announcement={announcement}
        onDeleted={onDeleted}
      />
    </>
  );
}

type Outcome = { tone: 'status' | 'alert'; text: string };

/**
 * Editează, "Fixează anunțul" / "Anulează fixarea" and Șterge (#857, #930),
 * only for a viewer `announcements_update` and `announcements_delete` let
 * through (`mayManageAnnouncement`). The feed's refetch carries every change:
 * an edit re-renders this sheet, a pin moves the card into or out of the
 * pinned band (R15), a delete removes the card and closes the sheet.
 */
function AnnouncementManageActions({
  announcement,
  onDeleted,
}: {
  announcement: AnnouncementPresentation;
  onDeleted: () => void;
}) {
  const bcOrModerator = useCapability('manageRoles').data === true;
  const managesAnyGroup = useCapability('managesAnyGroup').data === true;
  const myGroups = useMyGroupRoles();
  const setPinned = useSetAnnouncementPinned();
  const remove = useDeleteAnnouncement();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [editing, setEditing] = useState(false);
  // Each opening of Editează starts from the stored row.
  const [editOpenings, setEditOpenings] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (
    !mayManageAnnouncement(announcement, {
      bcOrModerator,
      managesAnyGroup,
      groups: myGroups.data,
    })
  )
    return null;

  const pinned = announcement.pinned;
  const busy = setPinned.isPending || remove.isPending;

  function toggle() {
    setOutcome(null);
    setPinned.mutate(
      { id: announcement.id, pinned: !pinned },
      {
        onSuccess: () =>
          setOutcome({
            tone: 'status',
            text: pinned
              ? 'Anunțul nu mai este fixat.'
              : 'Anunțul a fost fixat.',
          }),
        onError: (cause) =>
          setOutcome({
            tone: 'alert',
            text: isAnnouncementRefusal(cause)
              ? 'Nu poți modifica acest anunț.'
              : 'Nu am putut schimba fixarea. Încearcă din nou.',
          }),
      },
    );
  }

  function confirmDelete() {
    setDeleteError(null);
    remove.mutate(announcement.id, {
      onSuccess: () => {
        setConfirming(false);
        onDeleted();
      },
      onError: (cause) =>
        setDeleteError(
          isAnnouncementRefusal(cause)
            ? 'Nu poți șterge acest anunț.'
            : 'Nu am putut șterge anunțul. Încearcă din nou.',
        ),
    });
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={busy}
          onClick={() => {
            setOutcome(null);
            setEditOpenings((count) => count + 1);
            setEditing(true);
          }}
        >
          <Pencil className="size-4" aria-hidden="true" />
          Editează
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={busy}
          onClick={toggle}
        >
          {pinned ? (
            <PinOff className="size-4" aria-hidden="true" />
          ) : (
            <Pin className="size-4" aria-hidden="true" />
          )}
          {pinned ? 'Anulează fixarea' : 'Fixează anunțul'}
        </Button>
        <Button
          type="button"
          variant="destructive"
          className="gap-2 sm:ml-auto"
          disabled={busy}
          onClick={() => {
            setOutcome(null);
            setDeleteError(null);
            setConfirming(true);
          }}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Șterge
        </Button>
      </div>
      {outcome && (
        <p
          role={outcome.tone}
          className={
            outcome.tone === 'alert'
              ? 'm-0 text-sm text-destructive'
              : 'm-0 text-sm text-muted-foreground'
          }
        >
          {outcome.text}
        </p>
      )}

      <AnnouncementEditSheet
        key={editOpenings}
        announcement={announcement}
        open={editing}
        onOpenChange={setEditing}
        onSaved={() => {
          setEditing(false);
          setOutcome({ tone: 'status', text: 'Anunțul a fost actualizat.' });
        }}
      />

      <Dialog
        open={confirming}
        onOpenChange={(next) => {
          if (remove.isPending) return;
          setConfirming(next);
        }}
      >
        <DialogContent showCloseButton={!remove.isPending}>
          <DialogHeader>
            <DialogTitle>Ștergi anunțul?</DialogTitle>
            <DialogDescription>Membrii nu îl vor mai vedea.</DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setConfirming(false)}
            >
              Renunță
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={confirmDelete}
            >
              {remove.isPending ? 'Se șterge…' : 'Șterge anunțul'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
