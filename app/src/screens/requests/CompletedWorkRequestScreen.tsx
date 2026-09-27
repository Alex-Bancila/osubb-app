import { useState, type FormEvent } from 'react';
import { RequestDecisionQueue } from './RequestDecisionQueue';
import { CheckCircle2 } from 'lucide-react';
import { TaskDetailsSheet } from '../tracker/TaskDetailsSheet';
import { RequestStatusBadge } from './RequestStatusBadge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { commandErrorMessage } from '../../lib/command-reasons';
import { submitsWorkRequests } from '../../lib/capabilities';
import {
  EmptyState,
  ListRow,
  Page,
  PageGrid,
  PageHeader,
  Panel,
  rowListClass,
} from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  GroupOption,
  groupOptionLabel,
} from '../../components/ui/combobox';
import {
  useMyCompletedWorkRequests,
  useRequestOrigins,
  useSubmitCompletedWork,
  type RequestOrigin,
} from '../../queries/completed-work-requests';
import { useGroups, type Group } from '../../queries/reference';

// Parent names come from the Groups this Member may read; until they load, a
// Child Group is shown by its own name.
const NO_GROUPS: ReadonlyMap<number, Group> = new Map();

/** A refused Request, in the shared copy of `command-reasons.ts`. */
function safeSubmitError(error: unknown) {
  return commandErrorMessage(
    error,
    'Cererea nu a putut fi trimisă. Încearcă din nou.',
  );
}

export default function CompletedWorkRequestScreen() {
  const { claims } = useAuth();
  // BC and BCE do not work by points, so they have no use for filing a
  // Request for their own work (ruling R14, corrected 2026-09-22) — but they
  // may still hold decision authority below, which is not gated on level.
  const canSubmitRequests = submitsWorkRequests(claims);
  const origins = useRequestOrigins();
  const myRequests = useMyCompletedWorkRequests();
  const submit = useSubmitCompletedWork();
  const groups = useGroups();
  const groupsById = groups.data ?? NO_GROUPS;
  const [origin, setOrigin] = useState<RequestOrigin | null>(null);
  const [description, setDescription] = useState('');
  const [taskId, setTaskId] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submit.isPending) return;
    if (!origin || !description.trim()) return;
    try {
      await submit.mutateAsync({ origin, description: description.trim() });
      setDescription('');
      setOrigin(null);
      setSubmitted(true);
    } catch {
      setSubmitted(false);
    }
  }

  return (
    <Page width="reading">
      <PageHeader
        title="Cerere pentru activitate realizată"
        description={
          canSubmitRequests
            ? 'Descrie contribuția, iar coordonatorii grupului o vor evalua.'
            : undefined
        }
      />
      {/* Outside the grid: the queue renders nothing for a Member with no
          Request to decide (it is not a panel that may go missing). */}
      <RequestDecisionQueue />
      <PageGrid columns={1}>
        {canSubmitRequests && (
          <Panel
            title="Activitatea ta"
            description="Alege grupul pentru care ai lucrat: departamentul, echipa sau proiectul."
            descriptionId="request-origin-help"
          >
            {origins.isPending ? (
              <Loading label="Se încarcă grupurile…" />
            ) : origins.isError ? (
              <ErrorState
                error={origins.error}
                text="Nu am putut încărca grupurile."
                onRetry={() => void origins.refetch()}
              />
            ) : (
              <form
                className="space-y-5"
                onSubmit={(event) => void onSubmit(event)}
              >
                <div className="space-y-2">
                  <span
                    id="request-origin-label"
                    className="text-sm font-medium"
                  >
                    Grup
                  </span>
                  <Combobox<RequestOrigin>
                    items={origins.data ?? []}
                    value={origin}
                    onValueChange={(next) => {
                      setOrigin(next);
                      setSubmitted(false);
                    }}
                    itemToStringLabel={(item) =>
                      groupOptionLabel(item, groupsById)
                    }
                    isItemEqualToValue={(a, b) => a.id === b.id}
                    disabled={!origins.data?.length}
                  >
                    <ComboboxTrigger
                      className="min-h-11"
                      aria-labelledby="request-origin-label"
                      aria-describedby="request-origin-help"
                    >
                      <ComboboxValue placeholder="Alege grupul">
                        {(item: RequestOrigin | null) =>
                          item ? (
                            <GroupOption group={item} groupsById={groupsById} />
                          ) : (
                            'Alege grupul'
                          )
                        }
                      </ComboboxValue>
                    </ComboboxTrigger>
                    <ComboboxContent>
                      <ComboboxInput
                        aria-label="Caută un grup"
                        placeholder="Caută un grup"
                      />
                      <ComboboxEmpty />
                      <ComboboxList>
                        {(item: RequestOrigin) => (
                          <ComboboxItem key={item.id} value={item}>
                            <GroupOption group={item} groupsById={groupsById} />
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  {!origins.data?.length && (
                    <p className="text-sm text-muted-foreground">
                      Nu ai niciun grup activ disponibil pentru cereri.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="request-description"
                  >
                    Descriere
                  </label>
                  <textarea
                    id="request-description"
                    className="min-h-32 w-full rounded-lg border border-input bg-background p-3"
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setSubmitted(false);
                    }}
                    placeholder="Ce ai realizat și care a fost rezultatul?"
                    required
                  />
                </div>
                {submit.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {safeSubmitError(submit.error)}
                  </p>
                )}
                {submitted && (
                  <p
                    role="status"
                    className="flex items-center gap-2 text-sm text-green-700"
                  >
                    <CheckCircle2 className="size-4" />
                    Cererea a fost trimisă și apare în Cererile mele.
                  </p>
                )}
                <Button
                  className="min-h-11 min-w-11"
                  type="submit"
                  disabled={submit.isPending || !origin || !description.trim()}
                >
                  {submit.isPending ? 'Se trimite…' : 'Trimite cererea'}
                </Button>
              </form>
            )}
          </Panel>
        )}
        {canSubmitRequests && (
          <Panel title="Cererile mele">
            {myRequests.isPending ? (
              <Loading label="Se încarcă cererile…" />
            ) : myRequests.isError ? (
              <ErrorState
                error={myRequests.error}
                text="Nu am putut încărca cererile tale."
                onRetry={() => void myRequests.refetch()}
              />
            ) : myRequests.data?.length ? (
              <ul className={`${rowListClass} -mx-3`}>
                {myRequests.data.map((request) => (
                  <ListRow
                    key={request.id}
                    value={<RequestStatusBadge status={request.status} />}
                  >
                    <p className="wrap-anywhere">{request.description}</p>
                    {request.decision_note && (
                      <p className="mt-2 text-sm wrap-anywhere">
                        <span className="font-semibold">
                          {request.status === 'rejected'
                            ? 'Motivul respingerii: '
                            : 'Notă: '}
                        </span>
                        {request.decision_note}
                      </p>
                    )}
                    {request.status === 'approved' &&
                      request.task_id !== null && (
                        <Button
                          variant="link"
                          className="min-h-11 min-w-11 px-0"
                          onClick={() => setTaskId(request.task_id)}
                        >
                          Deschide taskul #{request.task_id}
                        </Button>
                      )}
                  </ListRow>
                ))}
              </ul>
            ) : (
              <EmptyState>Nu ai trimis încă nicio cerere.</EmptyState>
            )}
          </Panel>
        )}
      </PageGrid>
      <TaskDetailsSheet taskId={taskId} onClose={() => setTaskId(null)} />
    </Page>
  );
}
