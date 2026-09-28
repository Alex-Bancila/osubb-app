import { useMemo, type ReactNode } from 'react';
import { CheckIcon, ListFilter, Search, XIcon } from 'lucide-react';
import { cn } from 'cn';
import { SubHeading } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { GroupFilterCombobox } from '../../components/group/GroupFilterCombobox';
import { groupOptionLabel } from '../../components/ui/combobox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
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
 * The "Filtrează" button, with the number of active filters. It lives in the
 * page header's action slot (ruling R27) and opens `DirectoryFilterBar`'s
 * Dialog.
 */
export function DirectoryFilterButton({
  count,
  onOpen,
}: {
  count: number;
  onOpen: () => void;
}) {
  return (
    <Button
      variant="outline"
      aria-label={count ? `Filtrează, ${count} filtre active` : undefined}
      onClick={onOpen}
    >
      <ListFilter aria-hidden="true" />
      Filtrează
      {count > 0 && (
        <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
          {count}
          <span className="sr-only"> filtre active</span>
        </span>
      )}
    </Button>
  );
}

/**
 * The directory's filter controls: the search, a small Dialog (opened by
 * `DirectoryFilterButton`) for adding Group, role and status filters, and the
 * active filters as removable chips above the list.
 */
export function DirectoryFilterBar({
  members,
  filters,
  onChange,
  open,
  onOpenChange: setOpen,
  trailing,
}: {
  members: DirectoryMember[];
  filters: DirectoryFilters;
  onChange: (filters: DirectoryFilters) => void;
  /** Whether the filter Dialog is open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
          label: member.role,
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1 sm:max-w-sm">
          <span className="sr-only">Caută un membru</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            placeholder="Nume, grup, rol sau email"
            className="min-h-11 w-full rounded-lg border border-input bg-background pr-3 pl-9 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            value={filters.search}
            onChange={(event) =>
              onChange({ ...filters, search: event.target.value })
            }
          />
        </label>
        {trailing}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Filtrează membrii</DialogTitle>
            <DialogDescription>
              Alege grupurile, rolurile sau statutul membrilor pe care vrei să
              îi vezi. Lista se actualizează pe loc.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <SubHeading id="directory-filter-group">Grup</SubHeading>
            {groupsQuery.isError ? (
              <p role="alert" className="text-destructive">
                Nu am putut încărca grupurile.
              </p>
            ) : (
              <GroupFilterCombobox
                ariaLabelledBy="directory-filter-group"
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
            <p className="m-0 text-muted-foreground">
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

          {(roles.length > 1 || filters.roleIds.length > 0) && (
            <div className="grid gap-2">
              <SubHeading id="directory-filter-role">Rol</SubHeading>
              <div
                role="group"
                aria-labelledby="directory-filter-role"
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

          {/* One status is no choice (Rule W): Statut shows from two. */}
          {(statuses.length > 1 || filters.statuses.length > 0) && (
            <div className="grid gap-2">
              <SubHeading id="directory-filter-status">Statut</SubHeading>
              <div
                role="group"
                aria-labelledby="directory-filter-status"
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

          <DialogFooter>
            <Button variant="outline" disabled={!count} onClick={clear}>
              Șterge filtrele
            </Button>
            <DialogClose render={<Button />}>Gata</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {count > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <ul
            className="m-0 flex min-w-0 list-none flex-wrap gap-2 p-0"
            aria-label="Filtre active"
          >
            {filters.groupIds.map((id) => (
              <RemovableChip
                key={`group-${id}`}
                kind="Grup"
                text={groupLabel(id)}
                onRemove={() =>
                  onChange({
                    ...filters,
                    groupIds: filters.groupIds.filter((item) => item !== id),
                  })
                }
              />
            ))}
            {filters.roleIds.map((id) => (
              <RemovableChip
                key={`role-${id}`}
                kind="Rol"
                text={roles.find((role) => role.value === id)?.label ?? id}
                onRemove={() =>
                  onChange({ ...filters, roleIds: toggle(filters.roleIds, id) })
                }
              />
            ))}
            {filters.statuses.map((status) => (
              <RemovableChip
                key={`status-${status}`}
                kind="Statut"
                text={statusLabel(status)}
                onRemove={() =>
                  onChange({
                    ...filters,
                    statuses: toggle(filters.statuses, status),
                  })
                }
              />
            ))}
          </ul>
          <Button variant="ghost" size="sm" onClick={clear}>
            Șterge filtrele
          </Button>
        </div>
      )}
    </div>
  );
}
