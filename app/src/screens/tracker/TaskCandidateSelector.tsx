import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import {
  usePendingTaskCandidates,
  useSelectTaskCandidate,
} from '../../queries/task-candidate-selection';

export function TaskCandidateSelector({ taskId }: { taskId: number }) {
  const candidates = usePendingTaskCandidates(taskId);
  const selection = useSelectTaskCandidate();
  const [candidateId, setCandidateId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (candidates.isPending) return <p role="status">Se încarcă coada…</p>;
  if (candidates.isError)
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p>Nu am putut încărca persoanele din coadă.</p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 min-w-11"
          onClick={() => candidates.refetch()}
        >
          Reîncarcă lista
        </Button>
      </div>
    );
  if (!candidates.data.length)
    return (
      <p className="text-sm text-muted-foreground">
        Nu există persoane în coadă.
      </p>
    );

  const selected = candidates.data.find(
    (candidate) => candidate.id === candidateId,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      setError('Alege un candidat valid din coadă.');
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await selection.mutateAsync({ taskId, candidateId: selected.id });
      setMessage(`${selected.memberName} este acum executorul taskului.`);
    } catch (failure) {
      const kind =
        typeof failure === 'object' &&
        failure !== null &&
        'kind' in failure &&
        typeof failure.kind === 'string'
          ? failure.kind
          : null;
      const expectedFailure =
        kind === 'invalid' ||
        kind === 'missing' ||
        kind === 'conflict' ||
        kind === 'forbidden' ||
        kind === 'unknown';
      setError(
        expectedFailure && failure instanceof Error
          ? failure.message
          : 'Nu am putut schimba executorul. Încearcă din nou.',
      );
      if (kind === 'conflict' || kind === 'missing') await candidates.refetch();
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <fieldset className="space-y-2" disabled={selection.isPending}>
        <legend className="text-sm font-semibold">Alege din coadă</legend>
        <p className="text-sm text-muted-foreground">
          După alegere, coada rămâne deschisă pentru candidaturile rămase.
        </p>
        <div className="grid gap-2">
          {candidates.data.map((candidate, index) => (
            <label
              key={candidate.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-input px-3 py-2 has-checked:border-primary has-checked:bg-primary/5 focus-within:ring-2 focus-within:ring-ring/50"
            >
              <input
                type="radio"
                name={`task-${taskId}-candidate`}
                value={candidate.id}
                checked={candidateId === candidate.id}
                onChange={() => setCandidateId(candidate.id)}
                className="size-4 accent-primary"
              />
              <span className="min-w-0 text-sm">
                <span className="font-medium">{candidate.memberName}</span>{' '}
                <span className="text-muted-foreground">Locul {index + 1}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      <Button
        type="submit"
        className="min-h-11 min-w-11 w-full sm:w-auto"
        disabled={!selected || selection.isPending}
      >
        {selection.isPending ? 'Se atribuie…' : 'Alege executorul'}
      </Button>
    </form>
  );
}
