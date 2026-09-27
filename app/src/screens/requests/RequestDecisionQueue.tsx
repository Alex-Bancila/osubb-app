import { useRef, useState, type FormEvent } from 'react';
import { ListRow, Panel, rowListClass } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { ErrorState } from '../../components/states';
import { Button } from '../../components/ui/button';
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
/** Who asked, as a Member Card button, and the Group the work was done for. */
function RequesterLine({ request }: { request: PendingDecision }) {
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 font-semibold">
      <MemberName
        memberId={request.requester_id}
        nickname={request.requester_nickname}
        fullName={request.requester_name}
      />
      <span aria-hidden="true">·</span>
      <span className="min-w-0 wrap-anywhere">{request.group_name}</span>
    </p>
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
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="space-y-1">
        <label className="block space-y-1">
          <span>Motivul respingerii (obligatoriu)</span>
          <textarea
            required
            className="min-h-24 w-full rounded-md border border-input bg-background p-3"
            value={note}
            disabled={pending}
            onChange={(event) => setNote(event.target.value)}
            {...form.field('note')}
          />
        </label>
        <FieldError {...form.errorProps('note')} />
      </div>
      <FieldError>{form.formError}</FieldError>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          Respinge cererea
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Înapoi
        </Button>
      </div>
    </form>
  );
}

export function RequestDecisionQueue() {
  const queue = usePendingDecisions();
  const mutation = useRequestDecision();
  const [selected, setSelected] = useState<{
    request: PendingDecision;
    kind: 'approve' | 'reject';
  } | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const submitting = useRef(false);
  function open(request: PendingDecision, kind: 'approve' | 'reject') {
    setSelected({ request, kind });
    setReceipt(null);
  }
  /** Runs the decision; a refusal is thrown back to the form that asked. */
  async function decide(input: RequestDecision) {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await mutation.mutateAsync(input);
      setSelected(null);
      setReceipt(
        input.kind === 'approve'
          ? 'Cererea a fost aprobată. Activitatea și punctele au fost înregistrate.'
          : 'Cererea a fost respinsă. Solicitantul poate vedea nota deciziei.',
      );
    } finally {
      submitting.current = false;
    }
  }
  // Most members never decide a Request: until the server returns something
  // for them to decide, the section stays out of their way entirely.
  const nothingToDecide =
    queue.isPending || (!queue.isError && !queue.data?.length);
  if (nothingToDecide && !receipt && !selected) return null;
  return (
    <Panel
      title="Cereri de evaluat"
      description="Aici apar doar cererile pentru care poți lua o decizie."
      boxClassName="space-y-4"
    >
      {receipt && <TaskActionSuccess>{receipt}</TaskActionSuccess>}
      {selected ? (
        <div className="space-y-3">
          <RequesterLine request={selected.request} />
          <p className="whitespace-pre-wrap wrap-anywhere">
            {selected.request.description}
          </p>
          {selected.kind === 'approve' ? (
            <EvaluationFields
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
              onCancel={() => setSelected(null)}
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
              onCancel={() => setSelected(null)}
            />
          )}
        </div>
      ) : null}
      {queue.isPending ? null : queue.isError ? (
        <ErrorState
          error={queue.error}
          text="Nu am putut încărca cererile de evaluat."
          retryLabel="Reîncearcă"
          onRetry={() => void queue.refetch()}
        />
      ) : !queue.data?.length ? null : (
        <ul className={`${rowListClass} -mx-3`}>
          {queue.data.map((request) => (
            <ListRow
              key={request.id}
              stackAction
              action={
                <>
                  <Button
                    disabled={selected !== null || mutation.isPending}
                    onClick={() => open(request, 'approve')}
                  >
                    Evaluează cererea
                  </Button>
                  <Button
                    variant="outline"
                    disabled={selected !== null || mutation.isPending}
                    onClick={() => open(request, 'reject')}
                  >
                    Respinge
                  </Button>
                </>
              }
            >
              <RequesterLine request={request} />
              <p className="whitespace-pre-wrap wrap-anywhere">
                {request.description}
              </p>
            </ListRow>
          ))}
        </ul>
      )}
    </Panel>
  );
}
