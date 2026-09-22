import { useState, type FormEvent } from 'react';
import { MemberProfileButton } from '../../components/member/MemberProfileDialog';
import { Button } from '../../components/ui/button';
import {
  RadioCard,
  RadioGroup,
  RadioGroupItem,
} from '../../components/ui/radio-group';
import {
  usePendingTaskCandidates,
  useSelectTaskCandidate,
} from '../../queries/task-candidate-selection';

type QueueDecision = 'keep' | 'close';

const queueDecisions: {
  value: QueueDecision;
  label: string;
  description: string;
}[] = [
  {
    value: 'keep',
    label: 'Păstrează candidaturile rămase',
    description: 'Ceilalți rămân în coadă, în aceeași ordine.',
  },
  {
    value: 'close',
    label: 'Închide candidaturile rămase',
    description:
      'Coada se închide, iar ceilalți sunt anunțați că nu mai pot fi aleși.',
  },
];

export function TaskCandidateSelector({ taskId }: { taskId: number }) {
  const candidates = usePendingTaskCandidates(taskId);
  const selection = useSelectTaskCandidate();
  const [candidateId, setCandidateId] = useState<number | null>(null);
  const [queueDecision, setQueueDecision] = useState<QueueDecision | null>(
    null,
  );
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
      <>
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Nu există persoane în coadă.
        </p>
      </>
    );

  const selected = candidates.data.find(
    (candidate) => candidate.id === candidateId,
  );

  const hasRemaining = candidates.data.length > 1;
  const candidateHeadingId = `task-${taskId}-candidate-legend`;
  const remainingHeadingId = `task-${taskId}-remaining-legend`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      setError('Alege un candidat valid din coadă.');
      return;
    }
    if (hasRemaining && queueDecision === null) return;
    setError(null);
    setMessage(null);
    try {
      await selection.mutateAsync({
        taskId,
        candidateId: selected.id,
        ...(hasRemaining ? { closeRemaining: queueDecision === 'close' } : {}),
      });
      setMessage(`${selected.memberName} este acum executorul taskului.`);
      // The chosen person leaves the queue; a stale choice must not linger.
      setCandidateId(null);
      setQueueDecision(null);
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
    <form className="space-y-4" onSubmit={submit}>
      <div className="space-y-2">
        <p id={candidateHeadingId} className="text-sm font-semibold">
          Alege din coadă
        </p>
        <RadioGroup
          aria-labelledby={candidateHeadingId}
          value={candidateId}
          onValueChange={(value: number) => setCandidateId(value)}
          disabled={selection.isPending}
        >
          {candidates.data.map((candidate, index) => (
            <div key={candidate.id} className="flex items-center gap-2">
              <RadioCard className="min-w-0 flex-1">
                <RadioGroupItem value={candidate.id} />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium">
                    {candidate.memberName}
                  </span>
                  <span className="text-muted-foreground">
                    Locul {index + 1}
                  </span>
                </span>
              </RadioCard>
              <MemberProfileButton
                memberId={candidate.memberId}
                name={candidate.memberName}
                avatarColor={candidate.avatarColor}
              >
                <span className="hidden sm:inline">Profil</span>
              </MemberProfileButton>
            </div>
          ))}
        </RadioGroup>
      </div>
      {hasRemaining && (
        <div className="space-y-2">
          <p id={remainingHeadingId} className="text-sm font-semibold">
            Ce se întâmplă cu celelalte candidaturi?
          </p>
          <RadioGroup
            aria-labelledby={remainingHeadingId}
            value={queueDecision}
            onValueChange={(value: QueueDecision) => setQueueDecision(value)}
            disabled={selection.isPending}
          >
            {queueDecisions.map((choice) => (
              <RadioCard key={choice.value} className="items-start">
                <RadioGroupItem
                  value={choice.value}
                  aria-labelledby={`${remainingHeadingId}-${choice.value}-label`}
                  aria-describedby={`${remainingHeadingId}-${choice.value}`}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span
                    id={`${remainingHeadingId}-${choice.value}-label`}
                    className="block font-medium"
                  >
                    {choice.label}
                  </span>
                  <span
                    id={`${remainingHeadingId}-${choice.value}`}
                    className="text-muted-foreground"
                  >
                    {choice.description}
                  </span>
                </span>
              </RadioCard>
            ))}
          </RadioGroup>
        </div>
      )}
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
        disabled={
          !selected ||
          (hasRemaining && queueDecision === null) ||
          selection.isPending
        }
      >
        {selection.isPending ? 'Se atribuie…' : 'Alege executorul'}
      </Button>
    </form>
  );
}
