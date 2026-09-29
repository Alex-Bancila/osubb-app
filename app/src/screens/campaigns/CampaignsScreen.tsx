import { useMemo } from 'react';
import { Page, PageHeader } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { groupOptionLabel } from '../../components/ui/combobox';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import type { WorkFilterGroup } from '../../lib/work-filter';
import { useTaskFormOptions } from '../../queries/task-form-options';
import { groupLookup, groupOptions } from '../tracker/task-form-model';
import { CampaignsPanel } from './CampaignsPanel';
import type { CampaignOwnerGroup } from './campaign-list';
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
 *
 * With no Group chosen the page lists every Campaign the caller may read
 * (#908) — never a redirect or a default Group: filters only narrow. Rows of
 * Groups the caller does not manage show their name and owner only.
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
  // Every readable Group names a Campaign's owner; the managed ones carry
  // their paths. Only those may change a Campaign or read its report.
  const owners = useMemo<CampaignOwnerGroup[]>(() => {
    const ids = new Set(managed.map((row) => row.id));
    return [
      ...managed,
      ...(options.data?.groupNames ?? [])
        .filter((row) => !ids.has(row.id))
        .map((row) => ({ id: row.id, name: row.name, path: [] })),
    ];
  }, [managed, options.data]);
  const managedIds = useMemo(
    () => new Set(managed.map((row) => row.id)),
    [managed],
  );
  const filter = useCampaignsFilter(groups);
  const group = managed.find((row) => row.id === filter.routeGroupId);
  return (
    <Page width="reading">
      <PageHeader
        eyebrow="Administrare"
        title="Campanii"
        description="Toate campaniile, cu raportul celor din grupurile pe care le gestionezi."
      />
      {options.isPending ? (
        <Loading label="Se încarcă grupurile…" />
      ) : options.isError ? (
        <ErrorState
          error={options.error}
          text="Nu am putut încărca grupurile."
          retryLabel="Reîncearcă"
          onRetry={() => void options.refetch()}
        />
      ) : (
        groups.length > 0 && (
          <WorkFilter
            label="Filtre campanii"
            groups={groups}
            groupNames={options.data?.groupNames}
            campaigns={[]}
            levels={CAMPAIGNS_FILTER_LEVELS}
            roots="topmost"
            state={filter}
            hint="Grupul include toate subgrupurile sale. Perioada, după data acordării punctelor, se aplică raportului fiecărei campanii."
          />
        )
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
        options.isSuccess && (
          <CampaignsPanel
            label="Toate grupurile"
            groups={owners}
            range={filter.params}
            manages={(id) => managedIds.has(id)}
          />
        )
      )}
    </Page>
  );
}
