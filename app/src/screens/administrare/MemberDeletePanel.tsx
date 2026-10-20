import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  Consequences,
  DeleteForGoodDialog,
  type DeleteDialogControls,
} from '../../components/delete-for-good/DeleteForGoodDialog';
import { NO_UNDO } from '../../components/delete-for-good/delete-text';
import { Panel } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { describeFailure, reasonCopy } from '../../lib/command-reasons';
import {
  memberDeletable,
  useDeleteMember,
  useMemberDeletePreview,
  type MemberDeletePreview,
} from '../../queries/member-deletion';
import {
  MEMBERS_LIST_PATH,
  memberDeletedReceipt,
  memberGoesItems,
  memberHeldSentence,
  type MembersListState,
} from './member-delete-text';

const CHECKING = 'Se verifică dacă acest cont poate fi șters…';
const PREVIEW_FAILED = 'Nu am putut verifica acest cont.';
const DELETE_FAILED = 'Nu am putut șterge contul. Încearcă din nou.';

/**
 * Why there is no delete: the last active holder of a rank, or the history
 * the server named, with the way to deactivate instead (Roluri, a tab of the
 * same page — the back link's origin is kept, as a tab change keeps it).
 */
function Blocked({ preview }: { preview: MemberDeletePreview }) {
  const location = useLocation();
  if (preview.lastHolder)
    return (
      <p className="m-0 text-sm">
        {reasonCopy(`member_is_last_${preview.lastHolder}`)}
      </p>
    );
  return (
    <p className="m-0 text-sm">
      {memberHeldSentence(preview.holds)} Nu poate fi șters definitiv;{' '}
      <Link
        to={{ search: '?tab=roluri' }}
        state={location.state}
        replace
        className="font-medium underline underline-offset-4"
      >
        dezactivează-l din Roluri
      </Link>
      .
    </p>
  );
}

function MemberDeleteBody({
  memberId,
  fullName,
  controls,
}: {
  memberId: string;
  fullName: string;
  controls: DeleteDialogControls;
}) {
  const inputId = useId();
  const navigate = useNavigate();
  // Read again as the pop-up opens: history may have arrived since the page.
  const preview = useMemberDeletePreview(memberId);
  const remove = useDeleteMember();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === fullName.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!matches || remove.isPending) return;
    setError(null);
    controls.setBusy(true);
    try {
      await remove.mutateAsync(memberId);
      controls.close(true);
      const state: MembersListState = {
        receipt: memberDeletedReceipt(fullName),
      };
      void navigate(MEMBERS_LIST_PATH, { replace: true, state });
    } catch (failure) {
      controls.setBusy(false);
      const { reason, message } = describeFailure(failure, DELETE_FAILED);
      // Something now holds the account: read what, before anything else.
      if (
        reason === 'member_has_history' ||
        reason === 'member_is_last_bc' ||
        reason === 'member_is_last_moderator'
      )
        void preview.refetch();
      setError(message);
    }
  }

  const keep = (
    <Button
      type="button"
      variant="outline"
      disabled={remove.isPending}
      onClick={() => controls.close()}
    >
      Păstrează
    </Button>
  );

  if (preview.isPending)
    return <DialogDescription role="status">{CHECKING}</DialogDescription>;
  if (preview.isError)
    return (
      <>
        <DialogDescription role="alert" className="text-destructive">
          {describeFailure(preview.error, PREVIEW_FAILED).message}
        </DialogDescription>
        <DialogFooter>
          {keep}
          <Button type="button" onClick={() => void preview.refetch()}>
            Reîncearcă
          </Button>
        </DialogFooter>
      </>
    );
  if (!memberDeletable(preview.data))
    return (
      <>
        {/* A div: Blocked is a paragraph of its own. */}
        <DialogDescription render={<div />}>
          <Blocked preview={preview.data} />
        </DialogDescription>
        <DialogFooter>{keep}</DialogFooter>
      </>
    );

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogDescription>Odată cu contul se șterg:</DialogDescription>
      <Consequences
        label="Ce se șterge odată cu contul"
        items={memberGoesItems(preview.data.goes)}
      />
      <p className="m-0 text-sm text-muted-foreground">
        Nu rămâne nicio urmă, nici a ștergerii. {NO_UNDO}
      </p>
      <div className="grid gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          Scrie numele complet „{fullName}” ca să confirmi
        </label>
        <Input
          id={inputId}
          autoComplete="off"
          spellCheck={false}
          value={typed}
          disabled={remove.isPending}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        {keep}
        <Button
          type="submit"
          variant="destructive"
          disabled={remove.isPending || !matches}
        >
          {remove.isPending ? 'Se șterge…' : 'Șterge contul'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * **Ștergere** at the end of a Member's Cont tab (#1087, ruling R59), for BC
 * and the Moderator on anyone's page but their own. It asks the server what a
 * deletion would meet: an account with no history gets **Șterge definitiv**,
 * whose pop-up lists what goes and wants the full name typed; any other says
 * what holds it. The server decides again, under its lock, on the delete.
 */
export function MemberDeletePanel({
  memberId,
  fullName,
}: {
  memberId: string;
  fullName: string;
}) {
  const preview = useMemberDeletePreview(memberId);
  return (
    <Panel title="Ștergere">
      {preview.isPending ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {CHECKING}
        </p>
      ) : preview.isError ? (
        <div className="grid gap-3">
          <p role="alert" className="m-0 text-sm text-destructive">
            {describeFailure(preview.error, PREVIEW_FAILED).message}
          </p>
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            onClick={() => void preview.refetch()}
          >
            Reîncearcă
          </Button>
        </div>
      ) : memberDeletable(preview.data) ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 min-w-0 flex-1 basis-60 text-sm text-muted-foreground">
            Contul dispare cu tot ce ține de el și nu rămâne nicio urmă, nici a
            ștergerii.
          </p>
          <DeleteForGoodDialog title="Ștergi definitiv acest cont?">
            {(controls) => (
              <MemberDeleteBody
                memberId={memberId}
                fullName={fullName}
                controls={controls}
              />
            )}
          </DeleteForGoodDialog>
        </div>
      ) : (
        <Blocked preview={preview.data} />
      )}
    </Panel>
  );
}
