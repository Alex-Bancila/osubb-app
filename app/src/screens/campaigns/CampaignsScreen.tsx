import { useMemo } from 'react';
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
import { useTaskFormOptions } from '../../queries/task-form-options';
import {
  groupLookup,
  groupOptions,
  type ManagedWorkGroup,
} from '../tracker/task-form-model';
import { CampaignsPanel } from './CampaignsPanel';

export default function CampaignsScreen() {
  const { groupId: routeGroupId } = useParams();
  const navigate = useNavigate();
  const options = useTaskFormOptions();
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
      {group && (
        <CampaignsPanel
          group={group}
          label={groupOptionLabel(group, groupsById)}
        />
      )}
    </section>
  );
}
