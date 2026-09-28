import { useMemo } from 'react';
import { Navigate, useLocation } from 'react-router';
import { EmptyState, Page, PageHeader } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { groupOptionLabel } from '../../components/ui/combobox';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { rootGroups, type WorkFilterGroup } from '../../lib/work-filter';
import { useTaskFormOptions } from '../../queries/task-form-options';
import { groupLookup, groupOptions } from '../tracker/task-form-model';
import { CampaignsPanel } from './CampaignsPanel';
import {
  CAMPAIGNS_FILTER_LEVELS,
  campaignsPath,
  useCampaignsFilter,
} from './use-campaigns-filter';

/**
 * Campanii (ruling R13): the Work Filter without its Campaign level, over the
 * Groups the caller manages (`managed_work_groups()`), then the Campaigns of
 * the chosen Group and every Group below it. The route carries the chosen
 * Group; the date range dates each Campaign's report. The page's gate
 * (`manageTasks`) lives in `App.tsx`.
 *
 * With one topmost managed Group there is nothing to choose: the bare page
 * opens that Group's Campaigns directly (navigation D22).
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
  const { search } = useLocation();
  const group = managed.find((row) => row.id === filter.routeGroupId);
  const roots = useMemo(() => rootGroups(groups, 'topmost'), [groups]);
  const only = roots.length === 1 ? roots[0] : undefined;
  if (filter.routeGroupId === undefined && only)
    return <Navigate to={`${campaignsPath(only.id)}${search}`} replace />;
  return (
    <Page width="reading">
      <PageHeader
        eyebrow="Administrare"
        title="Campanii"
        description="Campaniile grupurilor pe care le gestionezi, cu raportul fiecăreia."
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
      ) : !groups.length ? (
        <EmptyState bare>
          Nu ai grupuri pentru care poți gestiona campanii.
        </EmptyState>
      ) : (
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
          <EmptyState bare>
            Alege un grup ca să-i vezi campaniile. O campanie etichetează
            taskurile unui grup și ale subgrupurilor lui; una inactivă nu mai
            poate fi aleasă pentru taskuri noi, dar rămâne pe cele existente.
          </EmptyState>
        )
      )}
    </Page>
  );
}
