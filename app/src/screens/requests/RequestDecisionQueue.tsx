import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { EvaluationFields } from '../../components/tasks/EvaluationFields';
import { TaskActionSuccess } from '../../components/tasks/TaskActionSuccess';
import {
  RequestDecisionError,
  usePendingDecisions,
  useRequestDecision,
  type PendingDecision,
  type RequestDecision,
} from '../../queries/request-decisions';
export function RequestDecisionQueue() {
  const queue = usePendingDecisions();
  const mutation = useRequestDecision();
  const [selected, setSelected] = useState<{
    request: PendingDecision;
    kind: 'approve' | 'reject';
  } | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const submitting = useRef(false);
  function open(request: PendingDecision, kind: 'approve' | 'reject') {
    setSelected({ request, kind });
    setNote('');
    setError(null);
    setReceipt(null);
  }
  async function decide(input: RequestDecision) {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    try {
      await mutation.mutateAsync(input);
      setSelected(null);
      setReceipt(
        input.kind === 'approve'
          ? 'Cererea a fost aprobată. Activitatea și punctele au fost înregistrate.'
          : 'Cererea a fost respinsă. Solicitantul poate vedea nota deciziei.',
      );
    } catch (failure) {
      const safe =
        failure instanceof RequestDecisionError
          ? failure.message
          : 'Nu am putut salva decizia. Reîncearcă.';
      setError(safe);
      throw new RequestDecisionError(safe);
    } finally {
      submitting.current = false;
    }
  }
  async function reject(event: FormEvent) {
    event.preventDefault();
    if (!selected || !note.trim()) {
      setError('Scrie o notă pentru această decizie.');
      return;
    }
    try {
      await decide({ kind: 'reject', requestId: selected.request.id, note });
    } catch {
      /* Safe feedback is retained above the form. */
    }
  }
  // Most members never decide a Request: until the server returns something
  // for them to decide, the section stays out of their way entirely.
  const nothingToDecide =
    queue.isPending || (!queue.isError && !queue.data?.length);
  if (nothingToDecide && !receipt && !selected) return null;
  return (
    <section aria-labelledby="request-decisions-title" className="space-y-4">
      <h2 id="request-decisions-title" className="text-lg font-bold">
        Cereri de evaluat
      </h2>
      <p className="text-sm text-muted-foreground">
        Aici apar doar cererile pentru care poți lua o decizie.
      </p>
      {receipt && <TaskActionSuccess>{receipt}</TaskActionSuccess>}
      {selected ? (
        <div className="space-y-3">
          <p className="font-semibold">
            {selected.request.requester_name} · {selected.request.group_name}
          </p>
          <p className="whitespace-pre-wrap wrap-anywhere">
            {selected.request.description}
          </p>
          {selected.kind === 'approve' ? (
            <EvaluationFields
              request
              executorName={selected.request.requester_name}
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
            <form onSubmit={reject} className="space-y-3">
              <label className="block space-y-1">
                <span>Motivul respingerii (obligatoriu)</span>
                <textarea
                  required
                  className="min-h-24 w-full rounded-md border border-input bg-background p-3"
                  value={note}
                  disabled={mutation.isPending}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={mutation.isPending || !note.trim()}
                >
                  Respinge cererea
                </Button>
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => setSelected(null)}
                >
                  Înapoi
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
      {queue.isPending ? null : queue.isError ? (
        <div role="alert">
          <p>Nu am putut încărca cererile de evaluat.</p>
          <Button variant="outline" onClick={() => void queue.refetch()}>
            Reîncearcă
          </Button>
        </div>
      ) : !queue.data?.length ? null : (
        <ul className="space-y-3">
          {queue.data.map((request) => (
            <li
              key={request.id}
              className="space-y-2 rounded-lg border bg-card p-4"
            >
              <p className="font-semibold">
                {request.requester_name} · {request.group_name}
              </p>
              <p className="whitespace-pre-wrap wrap-anywhere">
                {request.description}
              </p>
              <div className="flex flex-wrap gap-2">
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
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
