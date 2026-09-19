import { useEffect, useId, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  eligibleExecutors,
  filterExecutors,
  useDirectExecutors,
} from '../../queries/direct-executors';

export function DirectExecutorSelector({
  originGroupId,
  value,
  onChange,
  disabled = false,
}: {
  originGroupId: number;
  value: string | null;
  onChange: (memberId: string | null) => void;
  disabled?: boolean;
}) {
  const query = useDirectExecutors();
  const id = useId();
  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const data = query.data;
  const eligible = data ? eligibleExecutors(data, originGroupId) : [];
  const valid =
    value === null || eligible.some((member) => member.id === value);
  useEffect(() => {
    // Convenience filters never invalidate the selected Executor. Wait for a
    // successful authoritative read before clearing a now-ineligible member.
    if (query.isSuccess && !valid) onChange(null);
  }, [query.isSuccess, valid, onChange]);

  if (query.isPending) return <p role="status">Se încarcă membrii…</p>;
  if (query.isError || !data)
    return (
      <div role="alert" className="space-y-2">
        <p>Nu am putut încărca membrii.</p>
        <Button type="button" variant="outline" onClick={() => query.refetch()}>
          Reîncarcă lista
        </Button>
      </div>
    );
  const filtered = filterExecutors(
    data,
    originGroupId,
    search,
    groupId,
    campaignId,
  );
  const selected = eligible.find((member) => member.id === value);
  // Keep a chosen member visible in the native single-select even when search
  // hides them, so its value and the submitted ID cannot disagree.
  const options =
    selected && !filtered.includes(selected)
      ? [selected, ...filtered]
      : filtered;
  const control =
    'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="text-sm font-semibold">Alege executorul</legend>
      <p className="text-sm text-muted-foreground">
        Poți alege orice membru activ care îndeplinește nivelul minim al
        grupului de origine.
      </p>
      <div>
        <label htmlFor={`${id}-search`} className="text-sm">
          Caută după nume
        </label>
        <input
          id={`${id}-search`}
          type="search"
          className={control}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-group`} className="text-sm">
            Grup (include subgrupurile)
          </label>
          <select
            id={`${id}-group`}
            className={control}
            value={groupId ?? ''}
            onChange={(event) =>
              setGroupId(event.target.value ? Number(event.target.value) : null)
            }
          >
            <option value="">Toate grupurile</option>
            {data.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-campaign`} className="text-sm">
            Campanie
          </label>
          <select
            id={`${id}-campaign`}
            className={control}
            value={campaignId ?? ''}
            onChange={(event) =>
              setCampaignId(
                event.target.value ? Number(event.target.value) : null,
              )
            }
          >
            <option value="">Toate campaniile</option>
            {data.campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Filtrele folosesc apartenențele și istoricul de lucru pe care le poți
        vedea. Elimină filtrele pentru lista completă.
      </p>
      <div>
        <label htmlFor={`${id}-member`} className="text-sm">
          Executor
        </label>
        <select
          id={`${id}-member`}
          className={control}
          value={valid ? (value ?? '') : ''}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">Alege un membru</option>
          {options.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
              {selected === member && !filtered.includes(member)
                ? ' (selecție păstrată)'
                : ''}
            </option>
          ))}
        </select>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {!eligible.length
          ? 'Nu există membri eligibili pentru acest grup.'
          : !filtered.length
            ? 'Niciun membru nu corespunde filtrelor.'
            : `${filtered.length} membri corespund filtrelor.`}
      </p>
    </fieldset>
  );
}
