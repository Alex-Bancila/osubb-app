import { useMemo } from 'react';
import { Button } from '../../components/ui/button';
import { groupOptionLabel } from '../../components/ui/combobox';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import type { WorkFilterGroup } from '../../lib/work-filter';
import { useTaskFormOptions } from '../../queries/task-form-options';
import { groupLookup, groupOptions } from '../tracker/task-form-model';
import { CampaignsPanel } from './CampaignsPanel';
import {
  CAMPAIGNS_FILTER_LEVELS,
  useCampaignsFilter,
} from './use-campaigns-filter';

/**
 * Campanii (ruling R13): the Work Filter without its Campaign level, over the
 * Groups the caller manages (`managed_work_groups()`), then the Campaigns of
 * the chosen Group and every Group below it. The route carries the chosen
 * Group; the date range dates each Campaign's report. The page's gate
 * (`manageTasks`) lives in `App.tsx`.
 */
export default function CampaignsScreen() {
  const options = useTaskFormOptions();
  const managed = useMemo(
    () => groupOptions(options.data?.groups ?? []),
    [options.data],
  );
  // `managed_work_groups()` returns only Groups the caller may manage now
  // (active ones, or every Group for BC/Moderator), so each is offered.
  const groups = useMemo<WorkFilterGroup[]>(
    () => managed.map((group) => ({ ...group, status: 'active' })),
    [managed],
  );
  const groupsById = useMemo(
    () =>
      options.data
        ? groupLookup(options.data)
        : new Map<number, { name: string }>(),
    [options.data],
  );
  const filter = useCampaignsFilter(groups);
  const group = managed.find((row) => row.id === filter.routeGroupId);
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
        <section
          aria-label="Filtre campanii"
          className="rounded-xl border border-border bg-card p-4"
        >
          <WorkFilter
            groups={groups}
            groupNames={options.data?.groupNames}
            campaigns={[]}
            levels={CAMPAIGNS_FILTER_LEVELS}
            roots="topmost"
            state={filter}
            hint="Grupul include toate subgrupurile sale. Perioada, după data acordării punctelor, se aplică raportului fiecărei campanii."
          />
        </section>
      )}
      {filter.routeGroupId !== undefined && options.isSuccess && !group && (
        <p role="alert">
          Nu ai permisiunea de a gestiona campaniile acestui grup.
        </p>
      )}
      {group ? (
        <CampaignsPanel
          group={group}
          label={groupOptionLabel(group, groupsById)}
          groups={managed}
          range={filter.params}
        />
      ) : (
        filter.routeGroupId === undefined &&
        groups.length > 0 && (
          <p className="text-muted-foreground">
            Alege un grup ca să-i vezi campaniile.
          </p>
        )
      )}
    </section>
  );
}
