import { useMemo, type ReactNode } from 'react';
import { CheckIcon, XIcon } from 'lucide-react';
import { cn } from 'cn';
import { SubHeading } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { GroupFilterCombobox } from '../../components/group/GroupFilterCombobox';
import { groupOptionLabel } from '../../components/ui/combobox';
import {
  FilterSearch,
  FilterToolbar,
  type FilterChip,
} from '../../components/work-filter/FilterToolbar';
import type { DirectoryMember } from '../../queries/member-directory';
import { useGroups, type Group } from '../../queries/reference';
import {
  activeFilterCount,
  directoryGroupOptions,
  emptyFilters,
  statusLabel,
  toggle,
  type DirectoryFilters,
} from './directory-filters';

type Option<T> = { value: T; label: string };
const noGroups = new Map<number, Group>();

function ToggleChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        // Two equal columns on a phone (V2), so no label is left alone on
        // a row; from `sm` they flow in one wrapping line.
        'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-center text-sm leading-tight font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        pressed
          ? 'border-primary bg-primary/5 text-foreground'
          : 'border-border hover:bg-muted',
      )}
    >
      {pressed && <CheckIcon aria-hidden="true" className="size-4 shrink-0" />}
      {children}
    </button>
  );
}

/** The chip row of `ToggleChip`s: two columns under `sm`, a flow above. */
const toggleChipRowClass = 'grid grid-cols-2 gap-2 sm:flex sm:flex-wrap';

/**
 * An active filter, drawn as the Work Filter draws its chips (#845): the
 * kind muted, the value, and an X.
 */
function RemovableChip({
  kind,
  text,
  onRemove,
}: {
  kind: string;
  text: string;
  onRemove: () => void;
}) {
  return (
    <li className="min-w-0">
      <Button
        variant="secondary"
        size="sm"
        className="max-w-full"
        aria-label={`Elimină filtrul ${kind}: ${text}`}
        onClick={onRemove}
      >
        <span className="text-muted-foreground">{kind}:</span>
        <span className="max-w-48 truncate">{text}</span>
        <XIcon aria-hidden="true" />
      </Button>
    </li>
  );
}

/**
 * The directory's filter toolbar (#903): **Filtrează**, whose sheet adds
 * Group, role and status filters, then the search, the active filters as
 * removable chips, and the view switch at the end.
 */
export function DirectoryFilterBar({
  members,
  filters,
  onChange,
  trailing,
}: {
  members: DirectoryMember[];
  filters: DirectoryFilters;
  onChange: (filters: DirectoryFilters) => void;
  /** Controls that sit at the end of the toolbar (the view switch). */
  trailing?: ReactNode;
}) {
  const groupsQuery = useGroups();
  const groupsById = groupsQuery.data ?? noGroups;
  const groupOptions = useMemo(
    () =>
      directoryGroupOptions(groupsById.values(), members).sort((a, b) =>
        groupOptionLabel(a, groupsById).localeCompare(
          groupOptionLabel(b, groupsById),
          'ro',
        ),
      ),
    [groupsById, members],
  );
  const roles = useMemo(() => {
    const byId = new Map<string, { label: string; level: number }>();
    for (const member of members)
      if (member.roleId)
        byId.set(member.roleId, {
          // The Role's own name, never a member's Board Title (#963).
          label: member.rankLabel,
          level: member.roleLevel,
        });
    return [...byId]
      .sort(([, a], [, b]) => b.level - a.level)
      .map(([value, { label }]): Option<string> => ({ value, label }));
  }, [members]);
  const statuses = useMemo(
    () =>
      [...new Set(members.map((member) => member.status))]
        .sort((a, b) => a.localeCompare(b, 'ro'))
        .map((value): Option<string> => ({ value, label: statusLabel(value) })),
    [members],
  );
  const groupLabel = (id: number) => {
    const group = groupsById.get(id);
    return group ? groupOptionLabel(group, groupsById) : `#${id}`;
  };
  const count = activeFilterCount(filters);
  const clear = () => onChange({ ...emptyFilters, search: filters.search });

  const roleLabel = (id: string) =>
    roles.find((role) => role.value === id)?.label ?? id;
  const chips: FilterChip[] = [
    ...filters.groupIds.map((id): FilterChip => ({
      key: `group-${id}`,
      label: 'Grup',
      text: groupLabel(id),
      onRemove: () =>
        onChange({
          ...filters,
          groupIds: filters.groupIds.filter((item) => item !== id),
        }),
    })),
    ...filters.roleIds.map((id): FilterChip => ({
      key: `role-${id}`,
      label: 'Rol',
      text: roleLabel(id),
      onRemove: () =>
        onChange({ ...filters, roleIds: toggle(filters.roleIds, id) }),
    })),
    ...filters.statuses.map((status): FilterChip => ({
      key: `status-${status}`,
      label: 'Statut',
      text: statusLabel(status),
      onRemove: () =>
        onChange({ ...filters, statuses: toggle(filters.statuses, status) }),
    })),
  ];
  // One option is no choice (Rule W): Rol and Statut show from two.
  const showRoles = roles.length > 1 || filters.roleIds.length > 0;
  const showStatuses = statuses.length > 1 || filters.statuses.length > 0;

  return (
    <FilterToolbar
      label="Filtre membri"
      description="Alege grupurile, rolurile sau statutul membrilor pe care vrei să îi vezi. Lista se actualizează pe loc."
      count={count}
      chips={chips}
      onClear={clear}
      hidden={!groupOptions.length && !showRoles && !showStatuses && !count}
      search={
        <FilterSearch
          label="Caută un membru"
          placeholder="Nume, grup, rol sau email"
          value={filters.search}
          onChange={(event) =>
            onChange({ ...filters, search: event.target.value })
          }
        />
      }
      trailing={trailing}
    >
      {(prefix) => (
        <div className="grid gap-6">
          <div className="grid gap-2">
            <SubHeading id={`${prefix}-group`}>Grup</SubHeading>
            {groupsQuery.isError ? (
              <p role="alert" className="text-destructive">
                Nu am putut încărca grupurile.
              </p>
            ) : (
              <GroupFilterCombobox
                ariaLabelledBy={`${prefix}-group`}
                groups={groupOptions.filter(
                  (group) => !filters.groupIds.includes(group.id),
                )}
                groupsById={groupsById}
                value={null}
                onValueChange={(group: Group | null) => {
                  if (group)
                    onChange({
                      ...filters,
                      groupIds: [...filters.groupIds, group.id],
                    });
                }}
                placeholder="Adaugă un grup"
              />
            )}
            <p className="m-0 text-sm text-muted-foreground">
              Un grup îi include și pe membrii grupurilor din el.
            </p>
            {filters.groupIds.length > 0 && (
              <ul
                className="m-0 flex list-none flex-wrap gap-2 p-0"
                aria-label="Grupuri alese"
              >
                {filters.groupIds.map((id) => (
                  <RemovableChip
                    key={id}
                    kind="Grup"
                    text={groupLabel(id)}
                    onRemove={() =>
                      onChange({
                        ...filters,
                        groupIds: filters.groupIds.filter(
                          (item) => item !== id,
                        ),
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          {showRoles && (
            <div className="grid gap-2">
              <SubHeading id={`${prefix}-role`}>Rol</SubHeading>
              <div
                role="group"
                aria-labelledby={`${prefix}-role`}
                className={toggleChipRowClass}
              >
                {roles.map((role) => (
                  <ToggleChip
                    key={role.value}
                    pressed={filters.roleIds.includes(role.value)}
                    onClick={() =>
                      onChange({
                        ...filters,
                        roleIds: toggle(filters.roleIds, role.value),
                      })
                    }
                  >
                    {role.label}
                  </ToggleChip>
                ))}
              </div>
            </div>
          )}

          {showStatuses && (
            <div className="grid gap-2">
              <SubHeading id={`${prefix}-status`}>Statut</SubHeading>
              <div
                role="group"
                aria-labelledby={`${prefix}-status`}
                className={toggleChipRowClass}
              >
                {statuses.map((status) => (
                  <ToggleChip
                    key={status.value}
                    pressed={filters.statuses.includes(status.value)}
                    onClick={() =>
                      onChange({
                        ...filters,
                        statuses: toggle(filters.statuses, status.value),
                      })
                    }
                  >
                    {status.label}
                  </ToggleChip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </FilterToolbar>
  );
}
