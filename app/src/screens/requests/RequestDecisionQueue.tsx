import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ClipboardCheck } from 'lucide-react';
import {
  EmptyState,
  ListRow,
  Panel,
  rowListClass,
} from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { ErrorState, Loading } from '../../components/states';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FieldError } from '../../components/ui/field';
import { fieldForReason, rejectionNoteSchema } from '../../lib/schemas/note';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  CompletedTaskForm,
  type FixedVolunteer,
} from '../../components/tasks/CompletedTaskForm';
import { TaskActionSuccess } from '../../components/tasks/TaskActionSuccess';
import {
  useCompletedTaskGroups,
  type CompletedTaskDraft,
} from '../../queries/completed-tasks';
import { useReadNotificationsAbout } from '../../queries/notifications';
import {
  usePendingDecisions,
  useRequestDecision,
  type PendingDecision,
  type RequestDecision,
} from '../../queries/request-decisions';

/**
 * Who asked, as a Member Card button, over the Group the work was done for,
 * then what they did. Separate lines, so no separator is left hanging at the
 * end of a line when a long name wraps (#855, R2).
 */
function RequestSummary({ request }: { request: PendingDecision }) {
  return (
    <div className="min-w-0">
      <p className="m-0 font-semibold">
        <MemberName
          memberId={request.requester_id}
          nickname={request.requester_nickname}
          fullName={request.requester_name}
        />
      </p>
      <p
        data-slot="request-group"
        className="m-0 text-sm text-muted-foreground wrap-anywhere"
      >
        {request.group_name}
      </p>
      <p className="mt-2 mb-0 whitespace-pre-wrap wrap-anywhere">
        {request.description}
      </p>
    </div>
  );
}

/** Rejecting a Request: a required note of at most 1000 characters (R8). */
function RejectForm({
  pending,
  onReject,
  onCancel,
}: {
  pending: boolean;
  onReject: (note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const form = useFormValidation(rejectionNoteSchema, { note }, fieldForReason);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    try {
      await onReject(values.note);
    } catch (failure) {
      form.fail(failure, 'Nu am putut salva decizia. Reîncearcă.');
    }
  }
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-1.5">
        <label className="grid gap-1.5 text-sm font-medium">
          <span>Motivul respingerii (obligatoriu)</span>
          <textarea
            required
            className="min-h-24 w-full rounded-md border border-input bg-background p-3 font-normal"
            value={note}
            disabled={pending}
            onChange={(event) => setNote(event.target.value)}
            {...form.field('note')}
          />
        </label>
        <FieldError {...form.errorProps('note')} />
      </div>
      <FieldError>{form.formError}</FieldError>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          Renunță
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Se salvează…' : 'Respinge cererea'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Approving a Request (#915): the decider shapes the completed Task first —
 * title, details, Group (any Group they may credit the requester in), link,
 * Campaign — then gives the points. The Request's own Group is always
 * offered, so an approval without changes works as before.
 */
function ApproveRequestForm({
  request,
  isPending,
  onApprove,
  onCancel,
}: {
  request: PendingDecision;
  isPending: boolean;
  onApprove: (draft: CompletedTaskDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const groups = useCompletedTaskGroups(request.requester_id);
  const options = useMemo(() => {
    if (!groups.data) return null;
    const offered = groups.data.groups.some(
      (group) => group.id === request.group_id,
    );
    return offered
      ? groups.data
      : {
          ...groups.data,
          groups: [
            {
              id: request.group_id,
              name: request.group_name,
              path: [request.group_id],
              min_level: 0,
            },
            ...groups.data.groups,
          ],
        };
  }, [groups.data, request.group_id, request.group_name]);
  const volunteer: FixedVolunteer = {
    id: request.requester_id,
    nickname: request.requester_nickname ?? null,
    fullName: request.requester_name,
  };
  if (groups.isPending)
    return <Loading label="Se încarcă grupurile cererii…" />;
  if (groups.isError || !options)
    return (
      <ErrorState
        error={groups.error}
        text="Nu am putut încărca grupurile cererii."
        retryLabel="Reîncearcă"
        onRetry={() => void groups.refetch()}
      />
    );
  return (
    <CompletedTaskForm
      options={options}
      volunteer={volunteer}
      // The Request summary above already names the requester.
      volunteerLabel={null}
      initial={{
        // The Task's title is the Request's first 120 characters, as the
        // server writes it when nothing is changed.
        title: request.description.slice(0, 120),
        description: request.description,
        groupId: request.group_id,
      }}
      submitLabel="Aprobă și acordă punctele"
      isPending={isPending}
      onSubmit={onApprove}
      onCancel={onCancel}
    />
  );
}

type Selection = { request: PendingDecision; kind: 'approve' | 'reject' };

/**
 * The Requests the viewer may decide, each listed once: evaluating or
 * rejecting one opens a dialog over the list instead of a second copy of the
 * Request inside it (#855, R1).
 *
 * `showEmpty` is for a viewer who only decides (level 5 and up): the panel is
 * the whole page, so an empty queue says so. For everyone else the section
 * stays out of the way until the server returns something to decide.
 */
export function RequestDecisionQueue({
  showEmpty = false,
}: {
  showEmpty?: boolean;
}) {
  const queue = usePendingDecisions();
  // #1012 (R37): the Requests waiting here are open in front of the decider,
  // so their "Cerere nouă" Notifications are read.
  const queuedSubjects = useMemo(
    () =>
      (queue.data ?? []).map(
        (request) => `completed_work_request:${request.id}`,
      ),
    [queue.data],
  );
  useReadNotificationsAbout(queuedSubjects);
  const mutation = useRequestDecision();
  // Kept after the dialog closes, so its content does not vanish while it
  // animates out; cleared once it has.
  const [selected, setSelected] = useState<Selection | null>(null);
  const [open, setOpen] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const submitting = useRef(false);
  // After a decision the receipt takes focus: the row that opened the dialog
  // may have left the list.
  const decided = useRef(false);
  function openDialog(request: PendingDecision, kind: Selection['kind']) {
    decided.current = false;
    setSelected({ request, kind });
    setOpen(true);
    setReceipt(null);
  }
  function close() {
    if (!mutation.isPending) setOpen(false);
  }
  /** Runs the decision; a refusal is thrown back to the form that asked. */
  async function decide(input: RequestDecision) {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await mutation.mutateAsync(input);
      decided.current = true;
      setOpen(false);
      setReceipt(
        input.kind === 'approve'
          ? 'Cererea a fost aprobată. Activitatea și punctele au fost înregistrate.'
          : 'Cererea a fost respinsă. Solicitantul poate vedea nota deciziei.',
      );
    } finally {
      submitting.current = false;
    }
  }
  const rows = queue.isPending || queue.isError ? [] : (queue.data ?? []);
  const nothingToDecide = !queue.isError && rows.length === 0;
  // `selected` keeps the panel (and the dialog in it) mounted until the
  // dialog has finished closing, even if the queue emptied meanwhile.
  if (nothingToDecide && !receipt && !open && !selected && !showEmpty)
    return null;
  // A list alone fills the box edge to edge; with a receipt above it, the box
  // keeps its padding and the rows step out to meet it.
  const flush = rows.length > 0 && !receipt;
  return (
    <Panel
      eyebrow="De decis"
      icon={ClipboardCheck}
      title="Cereri de evaluat"
      flush={flush}
      stack={flush ? undefined : 3}
    >
      {receipt && <TaskActionSuccess>{receipt}</TaskActionSuccess>}
      {queue.isPending ? (
        showEmpty && <Loading label="Se încarcă cererile de evaluat…" />
      ) : queue.isError ? (
        <ErrorState
          error={queue.error}
          text="Nu am putut încărca cererile de evaluat."
          retryLabel="Reîncearcă"
          onRetry={() => void queue.refetch()}
        />
      ) : rows.length === 0 ? (
        !receipt && <EmptyState>Nicio cerere de evaluat.</EmptyState>
      ) : (
        <ul className={flush ? rowListClass : `${rowListClass} -mx-3`}>
          {rows.map((request) => (
            <ListRow
              key={request.id}
              stackAction
              action={
                <>
                  <Button
                    disabled={mutation.isPending}
                    onClick={() => openDialog(request, 'approve')}
                  >
                    Evaluează cererea
                  </Button>
                  <Button
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() => openDialog(request, 'reject')}
                  >
                    Respinge
                  </Button>
                </>
              }
            >
              <RequestSummary request={request} />
            </ListRow>
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        onOpenChangeComplete={(next) => {
          if (!next) setSelected(null);
        }}
      >
        <DialogContent
          finalFocus={() => !decided.current}
          // A form as long as a Task's: a sheet on a phone (#915).
          fullScreenOnPhone={selected?.kind === 'approve'}
          className={
            selected?.kind === 'approve' ? 'sm:max-w-2xl' : 'sm:max-w-lg'
          }
        >
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selected.kind === 'approve'
                    ? 'Evaluează cererea'
                    : 'Respinge cererea'}
                </DialogTitle>
                <DialogDescription>
                  {selected.kind === 'approve'
                    ? 'Aprobarea creează taskul finalizat așa cum îl lași mai jos și acordă punctele solicitantului.'
                    : 'Solicitantul vede motivul în Cererile mele.'}
                </DialogDescription>
              </DialogHeader>
              <div
                data-slot="request-under-decision"
                className="rounded-md bg-muted p-3"
              >
                <RequestSummary request={selected.request} />
              </div>
              {selected.kind === 'approve' ? (
                <ApproveRequestForm
                  key={selected.request.id}
                  request={selected.request}
                  isPending={mutation.isPending}
                  onApprove={(draft) =>
                    decide({
                      kind: 'approve',
                      requestId: selected.request.id,
                      difficulty: draft.difficulty,
                      rating: draft.rating,
                      note: draft.note,
                      task: {
                        title: draft.title,
                        description: draft.description,
                        groupId: draft.groupId,
                        link: draft.link,
                        campaignId: draft.campaignId,
                      },
                    })
                  }
                  onCancel={close}
                />
              ) : (
                <RejectForm
                  key={selected.request.id}
                  pending={mutation.isPending}
                  onReject={(note) =>
                    decide({
                      kind: 'reject',
                      requestId: selected.request.id,
                      note,
                    })
                  }
                  onCancel={close}
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
