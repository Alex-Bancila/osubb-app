import { useId, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { DirectExecutorSelector } from './DirectExecutorSelector';
import {
  campaignsFor,
  groupOptions,
  originFor,
  taskDraft,
  type TaskDraft,
  type TaskFormOptions,
  type TaskFormValues,
} from './task-form-model';

/** Draft-only form; its caller owns the eventual atomic create command. */
export function TaskForm({
  options,
  onDraft,
  parentTaskId = null,
}: {
  options: TaskFormOptions;
  onDraft: (draft: TaskDraft) => void;
  parentTaskId?: number | null;
}) {
  const id = useId();
  const [values, setValues] = useState<TaskFormValues>({
    title: '',
    description: '',
    deadline: '',
    groupId: null,
    kind: parentTaskId ? 'subtask' : 'task',
    parentTaskId,
    audience: 'local',
    assignmentMode: 'direct',
    executorId: null,
    campaignId: null,
  });
  const [error, setError] = useState<string | null>(null);
  const origin = originFor(values, options);
  const campaigns = campaignsFor(origin, options);
  const umbrella = values.kind === 'umbrella';
  const control =
    'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
  function update(patch: Partial<TaskFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
    setError(null);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const draft = taskDraft(values, options);
    if (typeof draft === 'string') {
      setError(draft);
      return;
    }
    setError(null);
    onDraft(draft);
  }
  if (!options.groups.length)
    return <p>Nu ai grupuri în care poți pregăti taskuri.</p>;
  return (
    <form
      aria-label="Pregătește un task"
      onSubmit={submit}
      noValidate
      className="space-y-5"
    >
      <h2 className="text-xl font-semibold">Pregătește un task</h2>
      <div>
        <label htmlFor={`${id}-kind`} className="text-sm font-medium">
          Tip
        </label>
        <select
          id={`${id}-kind`}
          className={control}
          value={values.kind}
          disabled={parentTaskId !== null}
          onChange={(event) =>
            update({
              kind:
                event.target.value === 'umbrella'
                  ? 'umbrella'
                  : event.target.value === 'subtask'
                    ? 'subtask'
                    : 'task',
              campaignId: null,
              executorId: null,
            })
          }
        >
          <option value="task">Task</option>
          <option value="umbrella">Task-umbrelă</option>
          <option value="subtask">Subtask</option>
        </select>
      </div>
      {values.kind === 'subtask' && (
        <div>
          <label htmlFor={`${id}-parent`} className="text-sm font-medium">
            Task-umbrelă (obligatoriu)
          </label>
          <select
            id={`${id}-parent`}
            className={control}
            value={values.parentTaskId ?? ''}
            disabled={parentTaskId !== null}
            onChange={(event) =>
              update({
                parentTaskId: event.target.value
                  ? Number(event.target.value)
                  : null,
                campaignId: null,
                executorId: null,
              })
            }
          >
            <option value="">Alege taskul-umbrelă</option>
            {options.umbrellas.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.title}
              </option>
            ))}
          </select>
          {!options.umbrellas.length && (
            <p className="text-sm">Nu există taskuri-umbrelă disponibile.</p>
          )}
        </div>
      )}
      <div>
        <label htmlFor={`${id}-title`} className="text-sm font-medium">
          Titlu (obligatoriu)
        </label>
        <input
          id={`${id}-title`}
          className={control}
          required
          value={values.title}
          onChange={(event) => update({ title: event.target.value })}
        />
      </div>
      <div>
        <label htmlFor={`${id}-description`} className="text-sm font-medium">
          Descriere
        </label>
        <textarea
          id={`${id}-description`}
          className={`${control} min-h-24`}
          rows={4}
          value={values.description}
          onChange={(event) => update({ description: event.target.value })}
        />
      </div>
      <div>
        <label htmlFor={`${id}-deadline`} className="text-sm font-medium">
          Termen{umbrella ? ' (opțional)' : ' (obligatoriu)'} — ora României
        </label>
        <input
          id={`${id}-deadline`}
          className={control}
          type="datetime-local"
          required={!umbrella}
          value={values.deadline}
          onChange={(event) => update({ deadline: event.target.value })}
        />
      </div>
      <div>
        <label htmlFor={`${id}-group`} className="text-sm font-medium">
          Grup de origine (obligatoriu)
        </label>
        <select
          id={`${id}-group`}
          className={control}
          required
          disabled={values.kind === 'subtask'}
          value={origin?.id ?? ''}
          onChange={(event) =>
            update({
              groupId: event.target.value ? Number(event.target.value) : null,
              campaignId: null,
              executorId: null,
            })
          }
        >
          <option value="">Alege un grup</option>
          {groupOptions(options.groups).map((group) => (
            <option key={group.id} value={group.id}>
              {'— '.repeat(group.depth)}
              {group.label}
            </option>
          ))}
        </select>
        {values.kind === 'subtask' && (
          <p className="text-sm text-muted-foreground">
            Originea este moștenită de la taskul-umbrelă și nu poate fi
            schimbată.
          </p>
        )}
      </div>
      {!umbrella && (
        <>
          <div>
            <label htmlFor={`${id}-campaign`} className="text-sm font-medium">
              Campanie (opțional)
            </label>
            <select
              id={`${id}-campaign`}
              className={control}
              value={
                campaigns.some((campaign) => campaign.id === values.campaignId)
                  ? (values.campaignId ?? '')
                  : ''
              }
              disabled={!origin}
              onChange={(event) =>
                update({
                  campaignId: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            >
              <option value="">Fără campanie</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
            {origin && !campaigns.length && (
              <p className="text-sm text-muted-foreground">
                Nu există campanii active pentru acest grup.
              </p>
            )}
          </div>
          <div>
            <label htmlFor={`${id}-mode`} className="text-sm font-medium">
              Mod de atribuire
            </label>
            <select
              id={`${id}-mode`}
              className={control}
              value={values.assignmentMode}
              onChange={(event) =>
                update({
                  assignmentMode:
                    event.target.value === 'public' ? 'public' : 'direct',
                  executorId: null,
                })
              }
            >
              <option value="direct">Direct</option>
              <option value="public">
                Public — înscriere prin lista de candidați
              </option>
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-audience`} className="text-sm font-medium">
              Audiență
            </label>
            <select
              id={`${id}-audience`}
              className={control}
              value={values.audience}
              onChange={(event) =>
                update({
                  audience: event.target.value === 'org' ? 'org' : 'local',
                })
              }
            >
              <option value="local">Membrii grupului de origine</option>
              <option value="org">Toți membrii eligibili OSUBB</option>
            </select>
            <p className="text-sm text-muted-foreground">
              Audiența decide cine se poate înscrie la un task public.
            </p>
          </div>
          {values.assignmentMode === 'direct' && origin && (
            <div>
              <DirectExecutorSelector
                originGroupId={origin.id}
                value={values.executorId}
                onChange={(executorId) => update({ executorId })}
              />
              <p className="text-sm text-muted-foreground">
                Executorul poate fi ales acum sau ulterior.
              </p>
            </div>
          )}
        </>
      )}
      {umbrella && (
        <p className="text-sm text-muted-foreground">
          Taskul-umbrelă grupează Subtaskuri. Nu are Executor, audiență,
          campanie sau punctaj propriu.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button className="min-h-11" type="submit">
        Continuă
      </Button>
    </form>
  );
}
