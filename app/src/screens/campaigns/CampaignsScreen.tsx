import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { useTaskFormOptions } from '../../queries/task-form-options';
import {
  CampaignError,
  useCampaignChange,
  useCampaigns,
  type Campaign,
  type CampaignChange,
} from '../../queries/campaigns';
import { groupOptions } from '../tracker/task-form-model';
const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
function CampaignEditor({
  campaign,
  onChange,
  disabled,
}: {
  campaign: Campaign;
  onChange: (change: CampaignChange) => Promise<boolean>;
  disabled: boolean;
}) {
  const [name, setName] = useState(campaign.name);
  return (
    <li className="space-y-3 rounded-lg border p-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onChange({ kind: 'rename', id: campaign.id, name });
        }}
      >
        <label className="min-w-0 flex-1 space-y-1">
          <span>Numele campaniei</span>
          <input
            className={control}
            value={name}
            required
            maxLength={200}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Button
          type="submit"
          disabled={disabled || !name.trim() || name.trim() === campaign.name}
        >
          Redenumește
        </Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{campaign.is_active ? 'Activă' : 'Inactivă'}</span>
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
      </div>
    </li>
  );
}
export default function CampaignsScreen() {
  const { groupId: routeGroupId } = useParams();
  const options = useTaskFormOptions();
  const campaigns = useCampaigns(
    routeGroupId ? Number(routeGroupId) : undefined,
  );
  const mutation = useCampaignChange();
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const groups = groupOptions(options.data?.groups ?? []);
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
  async function create(event: FormEvent) {
    event.preventDefault();
    if (
      group &&
      name.trim() &&
      (await save({ kind: 'create', groupId: group.id, name }))
    )
      setName('');
  }
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Campanii</h1>
        <p>
          Gestionează campaniile grupurilor pe care le coordonezi. Campaniile
          inactive rămân în istoricul taskurilor și în filtre.
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
        <nav aria-label="Grupuri administrate" className="flex flex-wrap gap-2">
          {groups.map((item) => (
            <Link
              key={item.id}
              aria-current={item.id === group?.id ? 'page' : undefined}
              className="inline-flex min-h-11 items-center rounded-md border px-3 py-2 underline"
              to={`/administrare/grupuri/${item.id}/campanii`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
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
          <h2 className="text-xl font-semibold">{group.label}</h2>
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 space-y-1">
              <span>Campanie nouă</span>
              <input
                className={control}
                required
                maxLength={200}
                disabled={mutation.isPending}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={mutation.isPending || !name.trim()}>
              Creează
            </Button>
          </form>
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
            <ul className="space-y-4" aria-label="Campaniile grupului">
              {campaigns.data
                ?.filter((row) => row.group_id === group.id)
                .map((campaign) => (
                  <CampaignEditor
                    key={`${campaign.id}:${campaign.name}`}
                    campaign={campaign}
                    onChange={save}
                    disabled={mutation.isPending}
                  />
                ))}
              {!campaigns.data?.some((row) => row.group_id === group.id) && (
                <li>Grupul nu are încă nicio campanie.</li>
              )}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
