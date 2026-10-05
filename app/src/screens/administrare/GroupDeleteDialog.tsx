import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Consequences,
  DeleteForGoodDialog,
  type DeleteDialogControls,
} from '../../components/delete-for-good/DeleteForGoodDialog';
import { NO_UNDO } from '../../components/delete-for-good/delete-text';
import { Button } from '../../components/ui/button';
import { DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { describeFailure } from '../../lib/command-reasons';
import {
  groupIsEmpty,
  useDeleteGroup,
  useGroupDeletePreview,
} from '../../queries/delete-for-good';
import type { AdminGroup } from '../../queries/groups-admin';
import {
  groupDeleteItems,
  GROUPS_LIST_PATH,
  type GroupsListState,
} from './group-delete-summary';
import { unfinishedTasksPath } from './group-tree';

const FAILED = 'Nu am putut șterge grupul. Încearcă din nou.';
const ARCHIVE_FAILED = 'Nu am putut arhiva grupul. Reîncearcă.';

/**
 * **Șterge definitiv** on a Group's page (#1017, ruling R38), for whoever may
 * archive it — and, for an archived Group, for BC and the Moderator. The
 * dialog reads what the subtree holds, then offers three ways out: delete
 * everything (after the Group's name is typed), archive it instead, or keep
 * it. A protected Group is never deleted; the dialog says why.
 */
export function GroupDeleteDialog({
  group,
  disabled,
  onArchive,
}: {
  group: Pick<AdminGroup, 'id' | 'name' | 'parent_id' | 'path'>;
  disabled: boolean;
  /** Archiving instead; absent for an archived Group or a non-archiver. */
  onArchive?: (onFailure: (failure: unknown) => void) => Promise<boolean>;
}) {
  return (
    <DeleteForGoodDialog
      title={`Ștergi definitiv grupul ${group.name}?`}
      disabled={disabled}
    >
      {(controls) => (
        <GroupDeleteBody
          group={group}
          controls={controls}
          onArchive={onArchive}
        />
      )}
    </DeleteForGoodDialog>
  );
}

function GroupDeleteBody({
  group,
  controls,
  onArchive,
}: {
  group: Pick<AdminGroup, 'id' | 'name' | 'parent_id' | 'path'>;
  controls: DeleteDialogControls;
  onArchive?: (onFailure: (failure: unknown) => void) => Promise<boolean>;
}) {
  const inputId = useId();
  const navigate = useNavigate();
  const preview = useGroupDeletePreview(group.id);
  const remove = useDeleteGroup();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<{
    text: string;
    openWork: boolean;
  } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const pending = remove.isPending || archiving;

  async function deleteAll(event: FormEvent) {
    event.preventDefault();
    if (!preview.data || typed.trim() !== group.name) return;
    setError(null);
    controls.setBusy(true);
    try {
      await remove.mutateAsync({
        groupId: group.id,
        mode: groupIsEmpty(preview.data) ? 'empty' : 'everything',
      });
      controls.close(true);
      const state: GroupsListState = {
        receipt: `Grupul ${group.name} a fost șters definitiv.`,
      };
      void navigate(GROUPS_LIST_PATH, { replace: true, state });
    } catch (failure) {
      controls.setBusy(false);
      const { reason, message } = describeFailure(failure, FAILED);
      // Content arrived since the preview: read it again before deciding.
      if (reason === 'group_not_empty' || reason === 'group_protected')
        void preview.refetch();
      setError({ text: message, openWork: false });
    }
  }

  async function archive() {
    if (!onArchive) return;
    setError(null);
    setArchiving(true);
    controls.setBusy(true);
    let refusal: unknown;
    const archived = await onArchive((failure) => {
      refusal = failure;
    });
    setArchiving(false);
    controls.setBusy(false);
    if (archived) {
      controls.close();
      return;
    }
    const { reason, message } = describeFailure(refusal, ARCHIVE_FAILED);
    setError({ text: message, openWork: reason === 'group_has_open_work' });
  }

  const errorLine = error && (
    <div role="alert" className="space-y-1 text-sm text-destructive">
      <p className="m-0">{error.text}</p>
      {error.openWork && (
        <Link
          to={unfinishedTasksPath(group)}
          className="inline-flex min-h-11 items-center underline"
        >
          Vezi taskurile neterminate
        </Link>
      )}
    </div>
  );
  const archiveButton = onArchive && (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() => void archive()}
    >
      {archiving ? 'Se arhivează…' : 'Arhivează'}
    </Button>
  );
  const keepButton = (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() => controls.close()}
    >
      Păstrează
    </Button>
  );

  if (preview.isPending)
    return (
      <DialogDescription role="status">
        Se verifică ce conține grupul…
      </DialogDescription>
    );
  if (preview.isError)
    return (
      <>
        <DialogDescription role="alert" className="text-destructive">
          {
            describeFailure(
              preview.error,
              'Nu am putut verifica ce conține grupul.',
            ).message
          }
        </DialogDescription>
        <DialogFooter>
          {keepButton}
          <Button type="button" onClick={() => void preview.refetch()}>
            Reîncearcă
          </Button>
        </DialogFooter>
      </>
    );

  if (preview.data.protected)
    return (
      <>
        <DialogDescription>
          {group.name} nu poate fi șters definitiv. Grupul organizației,
          grupurile cu membri adăugați automat și grupurile Biroului de
          Conducere sau Adunării Generale alese în Setări rămân mereu, la fel ca
          grupurile care le cuprind.
          {onArchive ? ' Îl poți arhiva.' : ''}
        </DialogDescription>
        {errorLine}
        <DialogFooter>
          {keepButton}
          {archiveButton}
        </DialogFooter>
      </>
    );

  const items = groupDeleteItems(preview.data);
  const nameMatches = typed.trim() === group.name;
  return (
    <form onSubmit={deleteAll} noValidate className="grid gap-4">
      <DialogDescription>
        {items.length > 0
          ? 'Odată cu grupul se șterg:'
          : 'Grupul nu are conținut.'}{' '}
        {items.length === 0 && NO_UNDO}
      </DialogDescription>
      {items.length > 0 && (
        <>
          <Consequences label="Ce se șterge odată cu grupul" items={items} />
          <p className="m-0 text-sm text-muted-foreground">
            {NO_UNDO}
            {onArchive
              ? ' Arhivarea păstrează istoricul și oprește grupul.'
              : ''}
          </p>
        </>
      )}
      <div className="grid gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          Scrie „{group.name}” ca să confirmi
        </label>
        <input
          id={inputId}
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={typed}
          disabled={pending}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
      {errorLine}
      <DialogFooter>
        {keepButton}
        {archiveButton}
        <Button
          type="submit"
          variant="destructive"
          disabled={pending || !nameMatches}
        >
          {remove.isPending ? 'Se șterge…' : 'Șterge tot'}
        </Button>
      </DialogFooter>
    </form>
  );
}
