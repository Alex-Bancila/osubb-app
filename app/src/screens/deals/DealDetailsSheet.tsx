import { useState } from 'react';
import { KeyRound, Pencil, Trash2 } from 'lucide-react';
import { EmptyState } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { Badge } from '../../components/ui/badge';
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
import {
  isAnnouncementRefusal,
  useDeleteAnnouncement,
} from '../../queries/announcements';
import { useDealRevealCount } from '../../queries/deals';
import AnnouncementReaders from '../announcements/AnnouncementReaders';
import { AnnouncementTermen } from '../announcements/AnnouncementTermen';
import { DealCodeStub } from './DealCodeStub';
import DealFormSheet from './DealFormSheet';
import { AttachedLinksList } from '../../components/attached-link/AttachedLinksList';
import {
  isDealActive,
  mayDeleteDeal,
  mayEditDeal,
  revealCountLabel,
  seesRevealCount,
  type DealPresentation,
  type DealsViewer,
} from './deals-presentation';
import { useDealsViewer } from './use-deals-viewer';

/**
 * One Deal in full (ruling R45): the text, the Deal Code's stub, every link as
 * "Deschide: <etichetă>" (R46), and for the team the readers and how many
 * opened the code, with Editează and Șterge as each may. A `?deal=` link to a
 * Deal the Member cannot read — expired, or deleted — says so.
 */
export default function DealDetailsSheet({
  deal,
  unavailable = false,
  onClose,
  onDeleted = onClose,
}: {
  deal: DealPresentation | null;
  unavailable?: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  if (!deal && !unavailable) return null;
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
          {deal ? (
            <DealDetails deal={deal} onDeleted={onDeleted} />
          ) : (
            <>
              <SheetHeader>
                <SheetTitle>Deal indisponibil</SheetTitle>
                <SheetDescription className="sr-only">
                  Deal-ul din link nu poate fi deschis.
                </SheetDescription>
              </SheetHeader>
              <EmptyState bare>
                Acest deal a expirat sau nu mai există.
              </EmptyState>
            </>
          )}
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}

function DealDetails({
  deal,
  onDeleted,
}: {
  deal: DealPresentation;
  onDeleted: () => void;
}) {
  const viewer = useDealsViewer();
  const expired = !isDealActive(deal);
  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-[0.14em] text-accent-foreground uppercase">
            OSUBB Deals
          </span>
          {expired && <Badge variant="outline">Expirat</Badge>}
        </div>
        <SheetTitle className="mt-1.5">{deal.title}</SheetTitle>
        <SheetDescription className="-mt-1 text-xs">
          <time dateTime={deal.publishedAt}>{deal.publishedLabel}</time>
        </SheetDescription>
        <AnnouncementTermen deadline={deal.deadline} className="self-start" />
        <div className="flex min-w-0 items-center text-xs pointer-coarse:-my-1.5">
          {deal.authorMember && (
            <MemberName {...deal.authorMember} size="sm" className="text-xs" />
          )}
        </div>
      </SheetHeader>

      <div className="text-sm leading-relaxed whitespace-pre-line text-foreground/90">
        {deal.body}
      </div>

      {deal.code && (
        // In the sheet the stub stands alone, a ticket of its own.
        <div className="overflow-clip rounded-md bg-card ring-1 ring-foreground/10">
          <DealCodeStub deal={deal} torn={false} />
        </div>
      )}

      <AttachedLinksList links={deal.links} variant="details" />

      <AnnouncementReaders
        announcement={{
          id: deal.id,
          authorMember: deal.authorMember,
          audience: 'org',
          groupId: deal.groupId,
        }}
      />

      {deal.code && seesRevealCount(viewer) && (
        <DealRevealCount dealId={deal.id} />
      )}

      <DealManageActions
        key={deal.id}
        deal={deal}
        viewer={viewer}
        onDeleted={onDeleted}
      />
    </>
  );
}

/** "Codul a fost deschis de N membri" — the team's, BC's and the Moderator's. */
export function DealRevealCount({
  dealId,
  className,
}: {
  dealId: number;
  className?: string;
}) {
  const count = useDealRevealCount(dealId, true);
  if (count.data === undefined || count.data === null) return null;
  return (
    <p
      className={
        className ??
        'm-0 flex items-center gap-2 rounded-md border p-4 text-sm font-semibold text-foreground'
      }
    >
      <KeyRound className="size-4 shrink-0" aria-hidden="true" />
      {revealCountLabel(count.data)}
    </p>
  );
}

type Outcome = { tone: 'status' | 'alert'; text: string };

/** Editează and Șterge, each for whom it is (`mayEditDeal`, `mayDeleteDeal`). */
export function DealManageActions({
  deal,
  viewer,
  onDeleted,
  compact = false,
}: {
  deal: DealPresentation;
  viewer: DealsViewer;
  onDeleted: () => void;
  /** On the team's list: no rule above, smaller buttons. */
  compact?: boolean;
}) {
  const remove = useDeleteAnnouncement();
  const [editing, setEditing] = useState(false);
  const [openings, setOpenings] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const canEdit = mayEditDeal(deal, viewer);
  const canDelete = mayDeleteDeal(deal, viewer);
  if (!canEdit && !canDelete) return null;

  function confirmDelete() {
    setDeleteError(null);
    remove.mutate(deal.id, {
      onSuccess: () => {
        setConfirming(false);
        onDeleted();
      },
      onError: (cause) =>
        setDeleteError(
          isAnnouncementRefusal(cause)
            ? 'Nu poți șterge acest deal.'
            : 'Nu am putut șterge deal-ul. Încearcă din nou.',
        ),
    });
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2 border-t pt-4'}>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size={compact ? 'sm' : 'default'}
            className="min-h-11 gap-2"
            disabled={remove.isPending}
            aria-label={compact ? `Editează ${deal.title}` : undefined}
            onClick={() => {
              setOutcome(null);
              setOpenings((count) => count + 1);
              setEditing(true);
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
            Editează
          </Button>
        )}
        {canDelete && (
          <Button
            type="button"
            variant={compact ? 'outline' : 'destructive'}
            size={compact ? 'sm' : 'default'}
            className={
              compact
                ? 'min-h-11 gap-2 text-destructive'
                : 'min-h-11 gap-2 sm:ml-auto'
            }
            disabled={remove.isPending}
            aria-label={compact ? `Șterge ${deal.title}` : undefined}
            onClick={() => {
              setOutcome(null);
              setDeleteError(null);
              setConfirming(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Șterge
          </Button>
        )}
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

      {canEdit && (
        <DealFormSheet
          key={openings}
          deal={deal}
          open={editing}
          onOpenChange={setEditing}
          onDone={() => {
            setEditing(false);
            setOutcome({ tone: 'status', text: 'Deal-ul a fost actualizat.' });
          }}
        />
      )}

      <Dialog
        open={confirming}
        onOpenChange={(next) => {
          if (remove.isPending) return;
          setConfirming(next);
        }}
      >
        <DialogContent showCloseButton={!remove.isPending}>
          <DialogHeader>
            <DialogTitle>Ștergi deal-ul?</DialogTitle>
            <DialogDescription>
              Membrii nu îl vor mai vedea, nici codul lui.
            </DialogDescription>
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
              {remove.isPending ? 'Se șterge…' : 'Șterge deal-ul'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
