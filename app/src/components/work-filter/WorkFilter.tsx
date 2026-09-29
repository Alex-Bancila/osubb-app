import { useMemo, type ReactNode } from 'react';
import { GroupFilterCombobox } from '../group/GroupFilterCombobox';
import { Button } from '../ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '../ui/combobox';
import { FieldError } from '../ui/field';
import { formatDayMonthYear } from '../../lib/format';
import { useWorkFilter, type WorkFilterState } from '../../lib/use-work-filter';
import {
  rootOf,
  workFilterChoices,
  workFilterGroupName,
  type WorkFilterCampaign,
  type WorkFilterChoices,
  type WorkFilterGroup,
  type WorkFilterLevel,
  type WorkFilterLevels,
  type WorkFilterRoots,
  type WorkItem,
} from '../../lib/work-filter';
import { workFilterCellClass, workFilterFieldClass } from './field-class';
import { FilterToolbar, type FilterChip } from './FilterToolbar';

/** A page's loading or failed option read, said in the toolbar. */
export type WorkFilterStatus = {
  pending?: boolean;
  failed?: boolean;
  error?: unknown;
  onRetry?: () => void;
};

type FieldsProps = {
  id: string;
  choices: WorkFilterChoices<WorkFilterGroup, WorkFilterCampaign>;
  groupsById: ReadonlyMap<number, { name: string }>;
  filter: WorkFilterState;
  showGroup: boolean;
  showCampaign: boolean;
  showDates: boolean;
  fields?: (id: string) => ReactNode;
};

/**
 * The controls, one column of cells in the filter sheet (#903): Grup
 * principal, Subgrup, Campanie, De la, Până la and any cells the page adds
 * (De gestionat's Stare and Ordonează).
 */
function WorkFilterFields({
  id,
  choices,
  groupsById,
  filter,
  showGroup,
  showCampaign,
  showDates,
  fields,
}: FieldsProps) {
  const { value, set, setSubgroup } = filter;
  const rootLabel = `${id}-root`;
  const subLabel = `${id}-sub`;
  const campaignLabel = `${id}-campaign`;
  const root = choices.roots.find((group) => group.id === value.rootGroupId);
  const sub = choices.below.find((group) => group.id === value.groupId);
  const campaign = choices.campaigns.find(
    (option) => option.id === value.campaignId,
  );
  const campaignLabelFor = (option: WorkFilterCampaign) => {
    const owner = groupsById.get(option.group_id)?.name;
    return owner ? `${option.name} · ${owner}` : option.name;
  };
  return (
    <div data-slot="work-filter-grid" className="grid grid-cols-1 gap-4">
      {showGroup && choices.showRoot && (
        <div className={workFilterCellClass}>
          <span id={rootLabel} className="text-sm font-medium">
            Grup principal
          </span>
          <GroupFilterCombobox
            ariaLabelledBy={rootLabel}
            groups={choices.roots}
            groupsById={groupsById}
            value={root ?? null}
            onValueChange={(group) => set('rootGroupId', group?.id)}
            placeholder="Toate grupurile"
          />
        </div>
      )}
      {showGroup && choices.showSub && (
        <div className={workFilterCellClass}>
          <span id={subLabel} className="text-sm font-medium">
            Subgrup
          </span>
          <GroupFilterCombobox
            ariaLabelledBy={subLabel}
            groups={choices.below}
            groupsById={groupsById}
            value={sub ?? null}
            onValueChange={(group) => {
              // With no Grup principal (#919), the Subgrup brings its own.
              const rootId =
                group && choices.rootId === undefined
                  ? rootOf(group, choices.roots)
                  : undefined;
              if (group && rootId !== undefined) setSubgroup(group.id, rootId);
              else set('groupId', group?.id);
            }}
            placeholder="Toate subgrupurile"
          />
        </div>
      )}
      {showCampaign && choices.showCampaign && (
        <div className={workFilterCellClass}>
          <span id={campaignLabel} className="text-sm font-medium">
            Campanie
          </span>
          <Combobox
            items={choices.campaigns}
            value={campaign ?? null}
            onValueChange={(next: WorkFilterCampaign | null) =>
              set('campaignId', next?.id)
            }
            itemToStringLabel={campaignLabelFor}
            disabled={!choices.campaigns.length}
          >
            <ComboboxTrigger aria-labelledby={campaignLabel}>
              <ComboboxValue placeholder="Toate campaniile" />
            </ComboboxTrigger>
            <ComboboxContent>
              <ComboboxInput
                placeholder="Caută o campanie"
                aria-label="Caută o campanie"
              />
              <ComboboxEmpty />
              <ComboboxList>
                {(option: WorkFilterCampaign) => {
                  const owner = groupsById.get(option.group_id);
                  return (
                    <ComboboxItem key={option.id} value={option}>
                      <span className="flex min-w-0 items-baseline gap-1">
                        <span className="truncate">{option.name}</span>
                        {owner && (
                          <span className="truncate text-xs text-muted-foreground">
                            <span aria-hidden="true">· </span>
                            {owner.name}
                          </span>
                        )}
                      </span>
                    </ComboboxItem>
                  );
                }}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      )}
      {showDates && (
        <>
          <label className={workFilterCellClass}>
            <span className="text-sm font-medium">De la</span>
            <input
              type="date"
              className={workFilterFieldClass}
              value={value.from ?? ''}
              max={value.to}
              onChange={(event) => set('from', event.target.value || undefined)}
            />
          </label>
          <div className={workFilterCellClass}>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Până la</span>
              <input
                type="date"
                className={workFilterFieldClass}
                value={value.to ?? ''}
                min={value.from}
                aria-invalid={filter.rangeError ? true : undefined}
                aria-describedby={
                  filter.rangeError ? `${id}-range-error` : undefined
                }
                onChange={(event) => set('to', event.target.value || undefined)}
              />
            </label>
            <FieldError id={`${id}-range-error`}>
              {filter.rangeError}
            </FieldError>
          </div>
        </>
      )}
      {fields?.(id)}
    </div>
  );
}

/**
 * The Work Filter (`CONTEXT.md`, ruling R3, #678): **Grup principal** →
 * **Subgrup** → **Campanie** → **De la** / **Până la**, each optional, with
 * its state in the URL through `useWorkFilter()`. The page reads the same hook
 * for its RPC arguments, so the control and the data never disagree.
 *
 * Rule W (#845): a page passes `work`, the items it can show, and the filter
 * offers only the Groups and Campaigns that own one of them (with their
 * parents, and whatever the URL already carries); a level with one option or
 * none is not drawn, and its URL value shows as a chip. Campanii passes no
 * `work`: it offers the Groups the caller manages, rooted at the topmost.
 *
 * At every width it is the filter toolbar (#903): **Filtrează** first, which
 * opens the controls in a sheet, then the page's search, then the active
 * filters as chips.
 */
export function WorkFilter({
  groups,
  campaigns,
  work,
  levels = {},
  roots = 'top-level',
  groupNames,
  state,
  hint,
  label = 'Filtre',
  status,
  fields,
  extraChips = [],
  search,
  trailing,
}: {
  groups: readonly WorkFilterGroup[];
  campaigns: readonly WorkFilterCampaign[];
  /** The items the page can show (Rule W); omit to offer every option. */
  work?: readonly WorkItem[];
  levels?: WorkFilterLevels;
  /** Where **Grup principal** starts; `topmost` for a page offering only managed Groups. */
  roots?: WorkFilterRoots;
  /** Names of Groups outside `groups` (a managed Team's parent), so an option shows its parent. */
  groupNames?: readonly { id: number; name: string }[];
  /**
   * The filter's state when the page keeps part of it elsewhere (Campanii
   * keeps the chosen Group in its route); defaults to `useWorkFilter(levels)`.
   */
  state?: WorkFilterState;
  /** A sentence under the sheet's title saying what this page's filter narrows. */
  hint?: ReactNode;
  /** The toolbar's accessible name ("Filtre calendar"). */
  label?: string;
  /** While the options load, or when they failed, the toolbar says so. */
  status?: WorkFilterStatus;
  /** More cells for the sheet (De gestionat's Stare, Ordonează), given a unique id prefix. */
  fields?: (id: string) => ReactNode;
  /** Chips for the page's own set cells, counted on the button. */
  extraChips?: readonly FilterChip[];
  /** The page's search, visible in the toolbar after the button. */
  search?: ReactNode;
  /** A page's view switch, at the end of the toolbar. */
  trailing?: ReactNode;
}) {
  const showGroup = levels.group ?? true;
  const showCampaign = levels.campaign ?? true;
  const showDates = levels.dates ?? true;
  const own = useWorkFilter(levels);
  const filter = state ?? own;
  const { value, set, clear } = filter;

  const named = useMemo(
    () =>
      groups.map((group) =>
        group.is_organization
          ? { ...group, name: workFilterGroupName(group) }
          : group,
      ),
    [groups],
  );
  const groupsById = useMemo(
    () =>
      new Map<number, { name: string }>([
        ...(groupNames ?? []).map((group) => [group.id, group] as const),
        ...named.map((group) => [group.id, group] as const),
      ]),
    [named, groupNames],
  );
  const choices = useMemo(
    () => workFilterChoices(named, campaigns, value, { work, roots }),
    [named, campaigns, value, work, roots],
  );

  if (status?.failed)
    return (
      <div
        role="alert"
        aria-label={label}
        className="flex flex-wrap items-center gap-2"
      >
        <p className="m-0 text-sm text-muted-foreground">
          Nu am putut încărca filtrele.
        </p>
        {status.onRetry && (
          <Button variant="outline" size="sm" onClick={status.onRetry}>
            Reîncarcă filtrele
          </Button>
        )}
      </div>
    );

  const groupText = (groupId: number) =>
    groupsById.get(groupId)?.name ?? `#${groupId}`;
  const level = (
    key: WorkFilterLevel,
    chipLabel: string,
    text: string,
    cascade: boolean,
  ): FilterChip => ({
    key,
    label: chipLabel,
    text,
    cascade,
    onRemove: () => set(key, undefined),
  });
  const chips: FilterChip[] = [];
  if (showGroup && value.rootGroupId !== undefined)
    chips.push(
      level(
        'rootGroupId',
        'Grup principal',
        groupText(value.rootGroupId),
        true,
      ),
    );
  if (showGroup && value.groupId !== undefined)
    chips.push(level('groupId', 'Subgrup', groupText(value.groupId), true));
  if (showCampaign && value.campaignId !== undefined)
    chips.push(
      level(
        'campaignId',
        'Campanie',
        campaigns.find((option) => option.id === value.campaignId)?.name ??
          `#${value.campaignId}`,
        true,
      ),
    );
  if (showDates && value.from)
    chips.push(
      level(
        'from',
        'De la',
        formatDayMonthYear(value.from) ?? value.from,
        false,
      ),
    );
  if (showDates && value.to)
    chips.push(
      level('to', 'Până la', formatDayMonthYear(value.to) ?? value.to, false),
    );
  chips.push(...extraChips);

  // Nothing to choose (every level hidden by Rule W, no page cell): no button.
  const offers =
    (showGroup && (choices.showRoot || choices.showSub)) ||
    (showCampaign && choices.showCampaign) ||
    showDates ||
    Boolean(fields);

  return (
    <FilterToolbar
      label={label}
      description={hint}
      count={chips.length}
      chips={chips}
      onClear={() => {
        clear();
        for (const chip of extraChips) chip.onRemove();
      }}
      hidden={!status?.pending && !offers}
      pending={status?.pending}
      search={search}
      trailing={trailing}
    >
      {(id) => (
        <WorkFilterFields
          id={id}
          choices={choices}
          groupsById={groupsById}
          filter={filter}
          showGroup={showGroup}
          showCampaign={showCampaign}
          showDates={showDates}
          fields={fields}
        />
      )}
    </FilterToolbar>
  );
}
