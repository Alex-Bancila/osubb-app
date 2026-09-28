import { useRef, useState, type FormEvent } from 'react';
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
import { fieldForReason, noteSchema } from '../../lib/schemas/note';
import { useFormValidation } from '../../lib/use-form-validation';
import { EvaluationFields } from '../../components/tasks/EvaluationFields';
import { TaskActionSuccess } from '../../components/tasks/TaskActionSuccess';
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
  const form = useFormValidation(noteSchema, { note }, fieldForReason);
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
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        >
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selected.kind === 'approve'
                    ? 'Evaluează cererea'
                    : 'Respinge cererea'}
                </DialogTitle>
                {selected.kind === 'reject' && (
                  <DialogDescription>
                    Solicitantul vede motivul în Cererile mele.
                  </DialogDescription>
                )}
              </DialogHeader>
              <div
                data-slot="request-under-decision"
                className="rounded-md bg-muted p-3"
              >
                <RequestSummary request={selected.request} />
              </div>
              {selected.kind === 'approve' ? (
                <EvaluationFields
                  inDialog
                  request
                  executorName={
                    selected.request.requester_nickname ||
                    selected.request.requester_name
                  }
                  isPending={mutation.isPending}
                  onEvaluate={(values) =>
                    decide({
                      kind: 'approve',
                      requestId: selected.request.id,
                      ...values,
                    })
                  }
                  onCancel={close}
                  onSuccess={() => {}}
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
