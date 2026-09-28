import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ListFilter, XIcon } from 'lucide-react';
import { cn } from 'cn';
import { GroupFilterCombobox } from '../group/GroupFilterCombobox';
import { Panel } from '../layout';
import { ErrorState, Loading } from '../states';
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
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from '../ui/sheet';
import { formatDayMonthYear } from '../../lib/format';
import { useWorkFilter, type WorkFilterState } from '../../lib/use-work-filter';
import {
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

type Chip = {
  /** The level whose removal this chip stands for. */
  level: WorkFilterLevel;
  label: string;
  text: string;
  /** Part of the Group → Subgrup → Campanie path, drawn joined by `›`. */
  cascade: boolean;
  /**
   * Whether the panel shows this level's control: then, from `md`, the chip
   * would repeat the value beside it (layout K1), so it shows only on a
   * phone, where the controls live in the sheet.
   */
  inPanel: boolean;
};

/** A page's loading or failed option read, shown in the panel's place. */
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
  /** Grid columns: the panel's `md:2 / xl:3`, or one column in the sheet. */
  gridClassName: string;
  fields?: (id: string) => ReactNode;
};

/**
 * The controls, one grid of equal cells (layout X4): Grup principal,
 * Subgrup, Campanie, De la, Până la and any cells the page adds (De
 * gestionat's Stare, Caută, Ordonează). Drawn in the panel from `md` and in
 * the sheet on a phone, each with its own ids.
 */
function WorkFilterFields({
  id,
  choices,
  groupsById,
  filter,
  showGroup,
  showCampaign,
  showDates,
  gridClassName,
  fields,
}: FieldsProps) {
  const { value, set } = filter;
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
    <div
      data-slot="work-filter-grid"
      className={cn('grid gap-4', gridClassName)}
    >
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
            onValueChange={(group) => set('groupId', group?.id)}
            placeholder="Toate subgrupurile"
            disabled={!choices.below.length}
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
 * From `md` the panel shows every control on one grid; on a phone it
 * collapses to a **Filtre (n)** button that opens the same controls in a
 * sheet, with the active filters as chips beside it (layout X3).
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
  fieldsActive = 0,
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
  /** A sentence under the fields saying what this page's filter narrows. */
  hint?: ReactNode;
  /** The panel's accessible name ("Filtre calendar"). */
  label?: string;
  /** While the options load, or when they failed, the panel says so instead. */
  status?: WorkFilterStatus;
  /** More cells for the same grid, given a unique id prefix per rendering. */
  fields?: (id: string) => ReactNode;
  /** How many of those extra cells are set, counted in **Filtre (n)**. */
  fieldsActive?: number;
}) {
  const showGroup = levels.group ?? true;
  const showCampaign = levels.campaign ?? true;
  const showDates = levels.dates ?? true;
  const own = useWorkFilter(levels);
  const filter = state ?? own;
  const { value, set, clear } = filter;
  const id = useId();
  const [sheetOpen, setSheetOpen] = useState(false);

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

  const groupText = (groupId: number) =>
    groupsById.get(groupId)?.name ?? `#${groupId}`;
  const chips: Chip[] = [];
  if (showGroup && value.rootGroupId !== undefined)
    chips.push({
      level: 'rootGroupId',
      label: 'Grup principal',
      text: groupText(value.rootGroupId),
      cascade: true,
      inPanel: choices.showRoot,
    });
  if (showGroup && value.groupId !== undefined)
    chips.push({
      level: 'groupId',
      label: 'Subgrup',
      text: groupText(value.groupId),
      cascade: true,
      inPanel: choices.showSub,
    });
  if (showCampaign && value.campaignId !== undefined)
    chips.push({
      level: 'campaignId',
      label: 'Campanie',
      text:
        campaigns.find((option) => option.id === value.campaignId)?.name ??
        `#${value.campaignId}`,
      cascade: true,
      inPanel: choices.showCampaign,
    });
  if (showDates && value.from)
    chips.push({
      level: 'from',
      label: 'De la',
      text: formatDayMonthYear(value.from) ?? value.from,
      cascade: false,
      inPanel: true,
    });
  if (showDates && value.to)
    chips.push({
      level: 'to',
      label: 'Până la',
      text: formatDayMonthYear(value.to) ?? value.to,
      cascade: false,
      inPanel: true,
    });
  const activeCount = chips.length + fieldsActive;

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
    // Only what this width shows: the phone's chips and button, or the
    // panel's controls.
    const shown = (element: HTMLElement) =>
      typeof element.checkVisibility === 'function'
        ? element.checkVisibility()
        : true;
    const buttons = [
      ...(chipRow.current?.querySelectorAll<HTMLElement>('button') ?? []),
    ].filter(shown);
    const controls = [
      ...(container.current?.querySelectorAll<HTMLElement>(
        '[data-slot=work-filter-grid] :is([aria-labelledby], input, select), [data-slot=work-filter-open]',
      ) ?? []),
    ].filter(shown);
    const target = buttons[Math.min(index, buttons.length - 1)] ?? controls[0];
    target?.focus();
  });

  function remove(chip: Chip, index: number) {
    refocus.current = { index, level: chip.level };
    setAnnouncement(`Filtrul ${chip.label}: ${chip.text} a fost eliminat.`);
    set(chip.level, undefined);
  }

  // From the sheet, focus stays in the sheet: nothing to move.
  function clearAll(fromSheet = false) {
    if (!fromSheet) refocus.current = { index: 0, level: null };
    setAnnouncement('Filtrele au fost șterse.');
    clear();
  }

  if (status?.pending || status?.failed)
    return (
      <Panel eyebrow="Filtre" icon={ListFilter} aria-label={label}>
        {status.failed ? (
          <ErrorState
            error={status.error}
            text="Nu am putut încărca filtrele."
            retryLabel="Reîncarcă filtrele"
            onRetry={status.onRetry}
          />
        ) : (
          <Loading label="Se încarcă filtrele…" />
        )}
      </Panel>
    );

  const fieldProps = {
    choices,
    groupsById,
    filter,
    showGroup,
    showCampaign,
    showDates,
    fields,
  };

  return (
    <Panel
      eyebrow="Filtre"
      icon={ListFilter}
      aria-label={label}
      // On a phone the header and the box give way to one line: the
      // Filtre (n) button and the chips.
      className="max-md:[&>[data-slot=section-header]]:hidden"
      boxClassName="max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none"
    >
      <div ref={container} className="flex flex-col gap-4">
        <div className="max-md:hidden">
          <WorkFilterFields
            {...fieldProps}
            id={`${id}-panel`}
            gridClassName="md:grid-cols-2 xl:grid-cols-3"
          />
        </div>
        {hint && (
          <p className="text-sm text-muted-foreground max-md:hidden">{hint}</p>
        )}
        {/* From `md` this row holds only a chip no control shows (a level
            Rule W hides) and Șterge filtrele. */}
        <div
          className={cn(
            'flex flex-wrap items-center gap-2',
            !chips.length && 'md:hidden',
          )}
        >
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger
              data-slot="work-filter-open"
              render={<Button variant="outline" />}
              className="md:hidden"
            >
              <ListFilter aria-hidden="true" />
              {activeCount ? `Filtre (${activeCount})` : 'Filtre'}
            </SheetTrigger>
            <SheetPortal>
              <SheetBackdrop />
              <SheetPopup side="right" className="max-w-md gap-4 p-4 sm:p-6">
                <SheetHeader>
                  <SheetTitle>Filtre</SheetTitle>
                  {hint && <SheetDescription>{hint}</SheetDescription>}
                </SheetHeader>
                <WorkFilterFields
                  {...fieldProps}
                  id={`${id}-sheet`}
                  gridClassName="grid-cols-1"
                />
                <SheetFooter>
                  {chips.length > 0 && (
                    <Button variant="outline" onClick={() => clearAll(true)}>
                      Șterge filtrele
                    </Button>
                  )}
                  <SheetClose render={<Button />}>Vezi rezultatele</SheetClose>
                </SheetFooter>
              </SheetPopup>
            </SheetPortal>
          </Sheet>
          {chips.length > 0 && (
            <div
              ref={chipRow}
              role="group"
              aria-label="Filtre active"
              className="flex min-w-0 flex-wrap items-center gap-2"
            >
              {chips.map((chip, index) => (
                <span
                  key={chip.level}
                  className={cn(
                    'inline-flex min-w-0 items-center gap-2',
                    chip.inPanel && 'md:hidden',
                  )}
                >
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
              <Button variant="ghost" size="sm" onClick={() => clearAll()}>
                Șterge filtrele
              </Button>
            </div>
          )}
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Panel>
  );
}
