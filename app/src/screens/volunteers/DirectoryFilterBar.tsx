import { useMemo, useState, type ReactNode } from 'react';
import { CheckIcon, ListFilter, Search, XIcon } from 'lucide-react';
import { cn } from 'cn';
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
        'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        pressed
          ? 'border-primary bg-primary/5 text-foreground'
          : 'border-border hover:bg-muted',
      )}
    >
      {pressed && <CheckIcon aria-hidden="true" className="size-4" />}
      {children}
    </button>
  );
}

function RemovableChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <li>
      <Button
        variant="secondary"
        size="sm"
        className="max-w-full rounded-full"
        aria-label={`Elimină filtrul ${label}`}
        onClick={onRemove}
      >
        <span className="truncate">{label}</span>
        <XIcon aria-hidden="true" />
      </Button>
    </li>
  );
}

/**
 * The directory's filter controls: a "Filtrează" button that opens a small
 * Dialog for adding Group, role and status filters, and the active filters as
 * removable chips above the list.
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
  const [open, setOpen] = useState(false);
  const groupsQuery = useGroups();
  const groupsById = groupsQuery.data ?? noGroups;
  const groupOptions = useMemo(
    () =>
      [...groupsById.values()]
        .filter((group) => group.status === 'active' && !group.is_organization)
        .sort((a, b) =>
          groupOptionLabel(a, groupsById).localeCompare(
            groupOptionLabel(b, groupsById),
            'ro',
          ),
        ),
    [groupsById],
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
        <Button
          variant="outline"
          aria-label={count ? `Filtrează, ${count} filtre active` : undefined}
          onClick={() => setOpen(true)}
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

          <section
            aria-labelledby="directory-filter-group"
            className="space-y-2"
          >
            <h3 id="directory-filter-group" className="font-semibold">
              Grup
            </h3>
            {groupsQuery.isError ? (
              <p role="alert" className="text-destructive">
                Nu am putut încărca grupurile.
              </p>
            ) : (
              <Combobox
                items={groupOptions.filter(
                  (group) => !filters.groupIds.includes(group.id),
                )}
                value={null}
                onValueChange={(group: Group | null) => {
                  if (group)
                    onChange({
                      ...filters,
                      groupIds: [...filters.groupIds, group.id],
                    });
                }}
                itemToStringLabel={(group: Group) =>
                  groupOptionLabel(group, groupsById)
                }
              >
                <ComboboxTrigger aria-labelledby="directory-filter-group">
                  <ComboboxValue placeholder="Adaugă un grup" />
                </ComboboxTrigger>
                <ComboboxContent>
                  <ComboboxInput
                    placeholder="Caută un grup"
                    aria-label="Caută un grup"
                  />
                  <ComboboxEmpty />
                  <ComboboxList>
                    {(group: Group) => (
                      <ComboboxItem key={group.id} value={group}>
                        <GroupOption group={group} groupsById={groupsById} />
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            )}
            <p className="text-muted-foreground">
              Un grup îi include și pe membrii grupurilor din el.
            </p>
            {filters.groupIds.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Grupuri alese">
                {filters.groupIds.map((id) => (
                  <RemovableChip
                    key={id}
                    label={`Grup: ${groupLabel(id)}`}
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
          </section>

          <fieldset className="space-y-2">
            <legend className="mb-2 font-semibold">Rol</legend>
            <div className="flex flex-wrap gap-2">
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
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-2 font-semibold">Statut</legend>
            <div className="flex flex-wrap gap-2">
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
          </fieldset>

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
          <ul className="flex flex-wrap gap-2" aria-label="Filtre active">
            {filters.groupIds.map((id) => (
              <RemovableChip
                key={`group-${id}`}
                label={`Grup: ${groupLabel(id)}`}
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
                label={`Rol: ${roles.find((role) => role.value === id)?.label ?? id}`}
                onRemove={() =>
                  onChange({ ...filters, roleIds: toggle(filters.roleIds, id) })
                }
              />
            ))}
            {filters.statuses.map((status) => (
              <RemovableChip
                key={`status-${status}`}
                label={`Statut: ${statusLabel(status)}`}
                onRemove={() =>
                  onChange({
                    ...filters,
                    statuses: toggle(filters.statuses, status),
                  })
                }
              />
            ))}
          </ul>
          <Button
            variant="link"
            className="px-2 text-foreground underline"
            onClick={clear}
          >
            Șterge filtrele
          </Button>
        </div>
      )}
    </div>
  );
}
