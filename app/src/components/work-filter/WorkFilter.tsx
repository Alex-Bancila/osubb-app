import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { XIcon } from 'lucide-react';
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
  campaignsFor,
  chosenGroupId,
  groupsBelow,
  rootGroups,
  workFilterGroupName,
  type WorkFilterCampaign,
  type WorkFilterGroup,
  type WorkFilterLevel,
  type WorkFilterLevels,
  type WorkFilterRoots,
} from '../../lib/work-filter';

const dateControl =
  'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20';

type Chip = {
  /** The level whose removal this chip stands for. */
  level: WorkFilterLevel;
  label: string;
  text: string;
  /** Part of the Group → Subgrup → Campanie path, drawn joined by `›`. */
  cascade: boolean;
};

/**
 * The Work Filter (`CONTEXT.md`, ruling R3, #678): **Grup principal** →
 * **Subgrup** → **Campanie** → **De la** / **Până la**, each optional, with
 * its state in the URL through `useWorkFilter()`. The page reads the same hook
 * for its RPC arguments, so the control and the data never disagree.
 *
 * The page passes the options it may offer — Campanii limits them to the
 * Groups the caller manages, rooted at the topmost of them — and hides the
 * levels it does not filter by, giving `useWorkFilter` the same `levels`.
 */
export function WorkFilter({
  groups,
  campaigns,
  levels = {},
  roots = 'top-level',
  groupNames,
  state,
  hint,
}: {
  groups: readonly WorkFilterGroup[];
  campaigns: readonly WorkFilterCampaign[];
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
  /** A sentence under the fields saying what this page's filter narrows. */
  hint?: ReactNode;
}) {
  const showCampaign = levels.campaign ?? true;
  const showDates = levels.dates ?? true;
  const own = useWorkFilter(levels);
  const filter = state ?? own;
  const { value, set, clear } = filter;
  const id = useId();
  const rootLabel = `${id}-root`;
  const subLabel = `${id}-sub`;
  const campaignLabel = `${id}-campaign`;

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
  const rootOptions = useMemo(() => rootGroups(named, roots), [named, roots]);
  const below = useMemo(
    () => groupsBelow(named, value.rootGroupId),
    [named, value.rootGroupId],
  );
  const campaignOptions = useMemo(
    () => campaignsFor(campaigns, named, chosenGroupId(value)),
    [campaigns, named, value],
  );
  const campaignLabelFor = (campaign: WorkFilterCampaign) => {
    const owner = groupsById.get(campaign.group_id)?.name;
    return owner ? `${campaign.name} · ${owner}` : campaign.name;
  };

  const root =
    rootOptions.find((group) => group.id === value.rootGroupId) ?? null;
  const sub = below.find((group) => group.id === value.groupId) ?? null;
  const campaign =
    campaigns.find((option) => option.id === value.campaignId) ?? null;

  const groupText = (groupId: number) =>
    groupsById.get(groupId)?.name ?? `#${groupId}`;
  const chips: Chip[] = [];
  if (value.rootGroupId !== undefined)
    chips.push({
      level: 'rootGroupId',
      label: 'Grup principal',
      text: groupText(value.rootGroupId),
      cascade: true,
    });
  if (value.groupId !== undefined)
    chips.push({
      level: 'groupId',
      label: 'Subgrup',
      text: groupText(value.groupId),
      cascade: true,
    });
  if (showCampaign && value.campaignId !== undefined)
    chips.push({
      level: 'campaignId',
      label: 'Campanie',
      text: campaign?.name ?? `#${value.campaignId}`,
      cascade: true,
    });
  if (showDates && value.from)
    chips.push({
      level: 'from',
      label: 'De la',
      text: formatDayMonthYear(value.from) ?? value.from,
      cascade: false,
    });
  if (showDates && value.to)
    chips.push({
      level: 'to',
      label: 'Până la',
      text: formatDayMonthYear(value.to) ?? value.to,
      cascade: false,
    });

  // A removed chip takes its button with it; focus moves to the chip now in
  // its place (or the one before), else back to the first control, and a
  // polite live region says what was removed.
  const container = useRef<HTMLDivElement>(null);
  const chipRow = useRef<HTMLDivElement>(null);
  // Which chip was removed and where it stood; `level: null` is "all of them".
  const refocus = useRef<{
    index: number;
    level: WorkFilterLevel | null;
  } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const pending = refocus.current;
    if (!pending) return;
    // Wait for the render in which the URL change has removed the chip(s).
    const gone =
      pending.level === null
        ? chips.length === 0
        : !chips.some((chip) => chip.level === pending.level);
    if (!gone) return;
    refocus.current = null;
    const index = pending.index;
    const buttons = [
      ...(chipRow.current?.querySelectorAll<HTMLElement>('button') ?? []),
    ];
    const target =
      buttons[Math.min(index, buttons.length - 1)] ??
      [
        ...(container.current?.querySelectorAll<HTMLElement>(
          '[aria-labelledby]',
        ) ?? []),
      ].find(
        (element) => element.getAttribute('aria-labelledby') === rootLabel,
      );
    target?.focus();
  });

  function remove(chip: Chip, index: number) {
    refocus.current = { index, level: chip.level };
    setAnnouncement(`Filtrul ${chip.label}: ${chip.text} a fost eliminat.`);
    set(chip.level, undefined);
  }

  function clearAll() {
    refocus.current = { index: 0, level: null };
    setAnnouncement('Filtrele au fost șterse.');
    clear();
  }

  return (
    <div ref={container} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="grid content-start gap-1.5">
          <span id={rootLabel} className="text-sm font-medium">
            Grup principal
          </span>
          <GroupFilterCombobox
            ariaLabelledBy={rootLabel}
            groups={rootOptions}
            groupsById={groupsById}
            value={root}
            onValueChange={(group) => set('rootGroupId', group?.id)}
            placeholder="Toate grupurile"
          />
        </div>
        <div className="grid content-start gap-1.5">
          <span id={subLabel} className="text-sm font-medium">
            Subgrup
          </span>
          <GroupFilterCombobox
            ariaLabelledBy={subLabel}
            groups={below}
            groupsById={groupsById}
            value={sub}
            onValueChange={(group) => set('groupId', group?.id)}
            placeholder="Toate subgrupurile"
            disabled={!below.length}
          />
        </div>
        {showCampaign && (
          <div className="grid content-start gap-1.5">
            <span id={campaignLabel} className="text-sm font-medium">
              Campanie
            </span>
            <Combobox
              items={campaignOptions}
              value={campaign}
              onValueChange={(next: WorkFilterCampaign | null) =>
                set('campaignId', next?.id)
              }
              itemToStringLabel={campaignLabelFor}
              disabled={!campaignOptions.length}
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
          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2 lg:col-span-3 lg:max-w-xl">
            <label className="grid content-start gap-1.5">
              <span className="text-sm font-medium">De la</span>
              <input
                type="date"
                className={dateControl}
                value={value.from ?? ''}
                max={value.to}
                onChange={(event) =>
                  set('from', event.target.value || undefined)
                }
              />
            </label>
            <div className="grid content-start gap-1.5">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Până la</span>
                <input
                  type="date"
                  className={dateControl}
                  value={value.to ?? ''}
                  min={value.from}
                  aria-invalid={filter.rangeError ? true : undefined}
                  aria-describedby={
                    filter.rangeError ? `${id}-range-error` : undefined
                  }
                  onChange={(event) =>
                    set('to', event.target.value || undefined)
                  }
                />
              </label>
              <FieldError id={`${id}-range-error`}>
                {filter.rangeError}
              </FieldError>
            </div>
          </div>
        )}
      </div>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {chips.length > 0 && (
        <div
          ref={chipRow}
          role="group"
          aria-label="Filtre active"
          className="flex flex-wrap items-center gap-2"
        >
          {chips.map((chip, index) => (
            <span key={chip.level} className="inline-flex items-center gap-2">
              {index > 0 && chip.cascade && chips[index - 1]?.cascade && (
                <span aria-hidden="true" className="text-muted-foreground">
                  ›
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Elimină filtrul ${chip.label}: ${chip.text}`}
                onClick={() => remove(chip, index)}
              >
                <span className="text-muted-foreground">{chip.label}:</span>
                <span className="max-w-48 truncate">{chip.text}</span>
                <XIcon aria-hidden="true" />
              </Button>
            </span>
          ))}
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Șterge filtrele
          </Button>
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
