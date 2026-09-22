import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useTaskFormOptions } from '../../queries/task-form-options';
import {
  CampaignError,
  useCampaignChange,
  useCampaigns,
  type Campaign,
  type CampaignChange,
} from '../../queries/campaigns';
import {
  groupLookup,
  groupOptions,
  type ManagedWorkGroup,
} from '../tracker/task-form-model';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/** A small pop-up that asks for one Campaign name: used to create and to rename. */
function CampaignNameDialog({
  title,
  label,
  submitLabel,
  initialName,
  trigger,
  disabled,
  error,
  onSave,
}: {
  title: string;
  label: string;
  submitLabel: string;
  initialName: string;
  trigger: string;
  disabled: boolean;
  /** The last save's refusal, shown inside the pop-up while it is open. */
  error: string | null;
  onSave: (name: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  // Show only a refusal of a save made from this pop-up since it opened.
  const [attempted, setAttempted] = useState(false);
  const unchanged = name.trim() === initialName.trim();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || unchanged) return;
    setAttempted(true);
    // A rejected save keeps the pop-up and the typed name for a retry.
    if (await onSave(name)) setOpen(false);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (next) {
          setName(initialName);
          setAttempted(false);
        }
      }}
    >
      <Button
        type="button"
        variant={initialName ? 'outline' : 'default'}
        disabled={disabled}
        onClick={() => {
          setName(initialName);
          setAttempted(false);
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{label}</span>
            <input
              className={control}
              value={name}
              required
              maxLength={200}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {attempted && error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => setOpen(false)}
            >
              Renunță
            </Button>
            <Button
              type="submit"
              disabled={disabled || !name.trim() || unchanged}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CampaignRow({
  campaign,
  onChange,
  disabled,
  error,
}: {
  campaign: Campaign;
  onChange: (change: CampaignChange) => Promise<boolean>;
  disabled: boolean;
  error: string | null;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
      <span className="grid min-w-0 gap-0.5">
        <span className="font-medium break-words">{campaign.name}</span>
        <span className="text-sm text-muted-foreground">
          {campaign.is_active ? 'Activă' : 'Inactivă'}
        </span>
      </span>
      <span className="flex flex-wrap gap-2">
        <CampaignNameDialog
          title="Redenumește campania"
          label="Numele campaniei"
          submitLabel="Salvează"
          trigger="Redenumește"
          initialName={campaign.name}
          disabled={disabled}
          error={error}
          onSave={(name) => onChange({ kind: 'rename', id: campaign.id, name })}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            void onChange({
              kind: 'active',
              id: campaign.id,
              active: !campaign.is_active,
            })
          }
        >
          {campaign.is_active ? 'Dezactivează' : 'Activează'}
        </Button>
      </span>
    </li>
  );
}

export default function CampaignsScreen() {
  const { groupId: routeGroupId } = useParams();
  const navigate = useNavigate();
  const options = useTaskFormOptions();
  const campaigns = useCampaigns(
    routeGroupId ? Number(routeGroupId) : undefined,
  );
  const mutation = useCampaignChange();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const groups = useMemo(
    () => groupOptions(options.data?.groups ?? []),
    [options.data],
  );
  const groupsById = useMemo(
    () =>
      options.data
        ? groupLookup(options.data)
        : new Map<number, { name: string }>(),
    [options.data],
  );
  const group = groups.find((row) => String(row.id) === routeGroupId);
  async function save(change: CampaignChange) {
    if (submitting.current || !group) return false;
    submitting.current = true;
    setError(null);
    setMessage(null);
    try {
      await mutation.mutateAsync(change);
      setMessage(
        change.kind === 'create'
          ? 'Campania a fost creată.'
          : change.kind === 'rename'
            ? 'Numele campaniei a fost actualizat.'
            : change.active
              ? 'Campania a fost activată.'
              : 'Campania a fost dezactivată. Taskurile existente păstrează campania.',
      );
      return true;
    } catch (failure) {
      setError(
        failure instanceof CampaignError
          ? failure.message
          : 'Nu am putut salva campania. Reîncearcă.',
      );
      return false;
    } finally {
      submitting.current = false;
    }
  }
  const own = campaigns.data?.filter((row) => row.group_id === group?.id);
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Campanii</h1>
        <p>
          O campanie este o etichetă pentru taskurile unui grup și ale
          subgrupurilor lui. Raportul campaniei arată punctele obținute și cine
          a lucrat. Campaniile inactive nu mai pot fi alese pentru taskuri noi,
          dar rămân pe taskurile existente.
        </p>
      </header>
      {options.isPending ? (
        <p role="status">Se încarcă grupurile…</p>
      ) : options.isError ? (
        <div role="alert">
          Nu am putut încărca grupurile.{' '}
          <Button variant="outline" onClick={() => void options.refetch()}>
            Reîncearcă
          </Button>
        </div>
      ) : !groups.length ? (
        <p>Nu ai grupuri pentru care poți gestiona campanii.</p>
      ) : (
        <div className="grid gap-1.5">
          <span id="campaign-group" className="text-sm font-medium">
            Grup
          </span>
          <Combobox<ManagedWorkGroup>
            items={groups}
            value={group ?? null}
            onValueChange={(next) => {
              if (next)
                void navigate(`/administrare/grupuri/${next.id}/campanii`);
            }}
            itemToStringLabel={(item) => groupOptionLabel(item, groupsById)}
            isItemEqualToValue={(a, b) => a.id === b.id}
          >
            <ComboboxTrigger aria-labelledby="campaign-group">
              <ComboboxValue placeholder="Alege un grup">
                {(item: ManagedWorkGroup | null) =>
                  item ? (
                    <GroupOption group={item} groupsById={groupsById} />
                  ) : (
                    'Alege un grup'
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
                {(item: ManagedWorkGroup) => (
                  <ComboboxItem key={item.id} value={item}>
                    <GroupOption group={item} groupsById={groupsById} />
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      )}
      {routeGroupId && options.isSuccess && !group && (
        <p role="alert">
          Nu ai permisiunea de a gestiona campaniile acestui grup.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {group && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">
              {groupOptionLabel(group, groupsById)}
            </h2>
            <CampaignNameDialog
              title="Campanie nouă"
              label="Numele campaniei"
              submitLabel="Creează"
              trigger="Campanie nouă"
              initialName=""
              disabled={mutation.isPending}
              error={error}
              onSave={(name) =>
                save({ kind: 'create', groupId: group.id, name })
              }
            />
          </div>
          {campaigns.isPending ? (
            <p role="status">Se încarcă campaniile…</p>
          ) : campaigns.isError ? (
            <div role="alert">
              Nu am putut încărca campaniile.{' '}
              <Button
                variant="outline"
                onClick={() => void campaigns.refetch()}
              >
                Reîncearcă
              </Button>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Campaniile grupului">
              {own?.map((campaign) => (
                <CampaignRow
                  key={`${campaign.id}:${campaign.name}`}
                  campaign={campaign}
                  onChange={save}
                  disabled={mutation.isPending}
                  error={error}
                />
              ))}
              {!own?.length && <li>Grupul nu are încă nicio campanie.</li>}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
