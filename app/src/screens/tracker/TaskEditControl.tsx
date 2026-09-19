import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import {
  bucharestWallTimeToIso,
  isoToBucharestWallTime,
} from '../../lib/calendar-time';
import { TaskEditError, useTaskEdit } from '../../queries/task-edit';
import { useTaskFormOptions } from '../../queries/task-form-options';
import { isTerminalTask, type TaskPresentationRow } from './task-presentation';
import { campaignsFor } from './task-form-model';
const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2';
export function TaskEditControl({
  task,
  canManage,
}: {
  task: TaskPresentationRow;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const receipt = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (saved) receipt.current?.focus();
  }, [saved]);
  const canEdit = canManage && !isTerminalTask(task.status);
  return (
    <section aria-label="Editarea taskului" className="space-y-3">
      {saved && (
        <p ref={receipt} role="status" tabIndex={-1}>
          Modificările au fost salvate și înregistrate în istoricul taskului.
        </p>
      )}
      {canEdit &&
        (open ? (
          <TaskContentForm
            task={task}
            onCancel={() => setOpen(false)}
            onSaved={() => {
              setOpen(false);
              setSaved(true);
            }}
          />
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              setOpen(true);
              setSaved(false);
            }}
          >
            Editează taskul
          </Button>
        ))}
    </section>
  );
}
function TaskContentForm({
  task,
  onCancel,
  onSaved,
}: {
  task: TaskPresentationRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const options = useTaskFormOptions();
  const mutation = useTaskEdit();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const initialDeadline = task.deadline
    ? isoToBucharestWallTime(task.deadline)
    : '';
  const [deadline, setDeadline] = useState(initialDeadline);
  const [campaignId, setCampaignId] = useState<number | null>(task.campaign_id);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const submitting = useRef(false);
  const group = options.data?.groups.find((row) => row.id === task.group_id);
  const campaigns = options.data ? campaignsFor(group, options.data) : [];
  const pending = checking || mutation.isPending;
  const umbrella = task.kind === 'umbrella';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    if (!title.trim()) {
      setError('Scrie titlul taskului.');
      return;
    }
    const instant =
      deadline === initialDeadline
        ? task.deadline
        : deadline
          ? bucharestWallTimeToIso(deadline)
          : null;
    if ((!umbrella && !instant) || (deadline && !instant)) {
      setError('Alege un termen valid, în ora Bucureștiului.');
      return;
    }
    submitting.current = true;
    setChecking(true);
    try {
      const fresh = await options.refetch();
      if (fresh.isError || !fresh.data)
        throw new TaskEditError(
          'Nu am putut verifica grupul și campaniile. Reîncearcă.',
        );
      const origin = fresh.data.groups.find((row) => row.id === task.group_id);
      if (!origin)
        throw new TaskEditError('Nu mai ai permisiunea de a edita acest task.');
      if (
        campaignId !== null &&
        campaignId !== task.campaign_id &&
        !campaignsFor(origin, fresh.data).some((row) => row.id === campaignId)
      )
        throw new TaskEditError(
          'Alege o campanie activă a grupului sau a unui grup părinte.',
        );
      await mutation.mutateAsync({
        taskId: task.id,
        title,
        description: description || null,
        deadline: instant,
        campaignId: umbrella ? null : campaignId,
      });
      onSaved();
    } catch (failure) {
      setError(
        failure instanceof TaskEditError
          ? failure.message
          : 'Nu am putut salva modificările. Reîncearcă.',
      );
    } finally {
      submitting.current = false;
      setChecking(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-lg border p-4"
      aria-label="Editează conținutul taskului"
    >
      <p className="text-sm">
        Grupul de origine, audiența și modul de atribuire se păstrează.
        Dificultatea se stabilește la evaluare.
      </p>
      <fieldset disabled={pending} className="space-y-3">
        <legend className="sr-only">Conținutul taskului</legend>
        <label className="block space-y-1">
          <span>Titlu</span>
          <input
            className={control}
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span>Descriere</span>
          <textarea
            className={control}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span>Termen (ora Bucureștiului)</span>
          <input
            className={control}
            type="datetime-local"
            required={!umbrella}
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
          />
        </label>
        {!umbrella && (
          <label className="block space-y-1">
            <span>Campanie</span>
            <select
              aria-label="Campanie"
              className={control}
              value={campaignId ?? ''}
              onChange={(event) =>
                setCampaignId(
                  event.target.value ? Number(event.target.value) : null,
                )
              }
            >
              <option value="">Fără campanie</option>
              {task.campaign_id !== null &&
                !campaigns.some((row) => row.id === task.campaign_id) && (
                  <option value={task.campaign_id}>
                    {task.campaign?.name ?? 'Campania existentă'} (păstrează
                    asocierea)
                  </option>
                )}
              {campaigns.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>
      {options.isPending && (
        <p role="status">Se verifică grupul și campaniile…</p>
      )}
      {options.isError && (
        <div role="alert">
          Nu am putut încărca opțiunile.{' '}
          <Button variant="outline" onClick={() => void options.refetch()}>
            Reîncearcă
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={pending || options.isPending || options.isError}
        >
          Salvează modificările
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Înapoi
        </Button>
      </div>
    </form>
  );
}
