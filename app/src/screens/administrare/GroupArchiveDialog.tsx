import { useState } from 'react';
import { Link } from 'react-router';
import { Consequences } from '../../components/delete-for-good/DeleteForGoodDialog';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { describeFailure } from '../../lib/command-reasons';
import {
  useGroupArchivePreview,
  type AdminGroup,
} from '../../queries/groups-admin';
import { groupArchiveItems, NO_UNARCHIVE } from './group-archive-summary';
import { unfinishedTasksPath } from './group-tree';

const PREVIEW_FAILED = 'Nu am putut verifica ce ar schimba arhivarea.';

type ArchiveTarget = Pick<AdminGroup, 'id' | 'name' | 'parent_id' | 'path'>;

/**
 * **Arhivează**, on the Setări tab (`variant="group"`) and on a Subgrupuri row
 * (`variant="child"`), with what archiving does read before the confirmation
 * (#1149, from `group_archive_preview`): every Group below archived, every
 * future Event of the subtree cancelled with Notifications to its attendees,
 * every pending Application declined with the applicant notified -- none of it
 * restored by Dezarhivează (ruling R65). The body exists only while the pop-up
 * is open, so the preview is fresh on every opening. The command's refusal
 * (`error`) shows once this dialog attempted an archive, with the way to the
 * unfinished work when that is the reason.
 */
export function GroupArchiveDialog({
  group,
  disabled,
  error,
  onArchive,
  variant = 'group',
}: {
  group: ArchiveTarget;
  disabled: boolean;
  /** The page's last archive refusal, in Romanian. */
  error: string | null;
  /** Runs `archive_group`; true when it went through. */
  onArchive: () => Promise<boolean>;
  variant?: 'group' | 'child';
}) {
  const [open, setOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const start = () => {
    setAttempted(false);
    setOpen(true);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (next) setAttempted(false);
      }}
    >
      {variant === 'group' ? (
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={start}
        >
          Arhivează grupul
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`Arhivează ${group.name}`}
          onClick={start}
        >
          Arhivează
        </Button>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arhivează {group.name}</DialogTitle>
        </DialogHeader>
        <ArchiveBody
          group={group}
          noun={variant === 'child' ? 'Subgrupul' : 'Grupul'}
          disabled={disabled}
          error={attempted ? error : null}
          onCancel={() => setOpen(false)}
          onArchive={async () => {
            setAttempted(true);
            if (await onArchive()) setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ArchiveBody({
  group,
  noun,
  disabled,
  error,
  onCancel,
  onArchive,
}: {
  group: ArchiveTarget;
  noun: 'Grupul' | 'Subgrupul';
  disabled: boolean;
  error: string | null;
  onCancel: () => void;
  onArchive: () => Promise<void>;
}) {
  const preview = useGroupArchivePreview(group.id);
  const cancelButton = (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={onCancel}
    >
      Renunță
    </Button>
  );

  if (preview.isPending)
    return (
      <>
        <DialogDescription role="status">
          Se verifică ce ar schimba arhivarea…
        </DialogDescription>
        <DialogFooter>{cancelButton}</DialogFooter>
      </>
    );
  if (preview.isError)
    return (
      <>
        <DialogDescription role="alert" className="text-destructive">
          {describeFailure(preview.error, PREVIEW_FAILED).message}
        </DialogDescription>
        <DialogFooter>
          {cancelButton}
          <Button type="button" onClick={() => void preview.refetch()}>
            Reîncearcă
          </Button>
        </DialogFooter>
      </>
    );

  const items = groupArchiveItems(preview.data);
  return (
    <>
      {items.length === 0 ? (
        <DialogDescription>
          {noun} nu mai poate primi taskuri, evenimente sau membri noi.
          Istoricul rămâne.
        </DialogDescription>
      ) : (
        <>
          <DialogDescription>Odată cu arhivarea:</DialogDescription>
          <Consequences label="Ce se întâmplă la arhivare" items={items} />
          <p className="m-0 text-sm text-muted-foreground">
            {NO_UNARCHIVE} {noun} nu mai primește taskuri, evenimente sau membri
            noi; istoricul rămâne.
          </p>
        </>
      )}
      {error && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p className="m-0">{error}</p>
          <Link
            to={unfinishedTasksPath(group)}
            className="inline-flex min-h-11 items-center underline"
          >
            Vezi taskurile neterminate
          </Link>
        </div>
      )}
      <DialogFooter>
        {cancelButton}
        <Button
          type="button"
          variant="destructive"
          disabled={disabled}
          onClick={() => void onArchive()}
        >
          Arhivează
        </Button>
      </DialogFooter>
    </>
  );
}
