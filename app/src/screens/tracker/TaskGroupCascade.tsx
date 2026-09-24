import { useId, useMemo } from 'react';
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
  groupsBelow,
  rootGroups,
  rootOf,
  type ManagedWorkGroup,
} from './task-form-model';

const ONLY_ROOT = 'Doar grupul principal';

/**
 * The Task's Origin as two steps (ruling R3): **Grup principal** — a managed
 * Group with no managed ancestor — then, optionally, a **Subgrup** anywhere
 * below it. Choosing only the first step picks that Group itself, so the
 * value is always exactly one Group. The Work Filter (#678) is a different
 * control; this one only ever offers Groups the caller manages.
 */
export function TaskGroupCascade({
  groups,
  groupsById,
  value,
  onChange,
  disabled = false,
  describedBy,
  invalid = false,
}: {
  groups: ManagedWorkGroup[];
  /** Names of every readable Group, so an option can show its parent. */
  groupsById: ReadonlyMap<number, { name: string }>;
  value: number | null;
  onChange: (group: ManagedWorkGroup) => void;
  disabled?: boolean;
  /** A hint or error both triggers should announce. */
  describedBy?: string;
  /** True while the chosen Group has an error: both steps say so. */
  invalid?: boolean;
}) {
  const id = useId();
  const roots = useMemo(() => rootGroups(groups), [groups]);
  const root = rootOf(value, groups) ?? null;
  const below = useMemo(
    () => (root ? groupsBelow(root.id, groups) : []),
    [root, groups],
  );
  const selected = groups.find((group) => group.id === value) ?? null;
  const label = (group: ManagedWorkGroup) =>
    groupOptionLabel(group, groupsById);
  const subLabel = (group: ManagedWorkGroup) =>
    group.id === root?.id ? ONLY_ROOT : label(group);
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <span id={`${id}-root`} className="text-sm font-medium">
          Grup principal (obligatoriu)
        </span>
        <Combobox<ManagedWorkGroup>
          items={roots}
          value={root}
          onValueChange={(group) => {
            if (group) onChange(group);
          }}
          itemToStringLabel={label}
          isItemEqualToValue={(a, b) => a.id === b.id}
          disabled={disabled}
        >
          <ComboboxTrigger
            aria-labelledby={`${id}-root`}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          >
            <ComboboxValue placeholder="Alege un grup">
              {(group: ManagedWorkGroup | null) =>
                group ? (
                  <GroupOption group={group} groupsById={groupsById} />
                ) : (
                  'Alege un grup'
                )
              }
            </ComboboxValue>
          </ComboboxTrigger>
          <ComboboxContent>
            <ComboboxInput
              aria-label="Caută un grup principal"
              placeholder="Caută un grup"
            />
            <ComboboxEmpty />
            <ComboboxList>
              {(group: ManagedWorkGroup) => (
                <ComboboxItem key={group.id} value={group}>
                  <GroupOption group={group} groupsById={groupsById} />
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
      {root && below.length > 0 && (
        <div className="grid gap-1.5">
          <span id={`${id}-sub`} className="text-sm font-medium">
            Subgrup (opțional)
          </span>
          <Combobox<ManagedWorkGroup>
            items={[root, ...below]}
            value={selected}
            onValueChange={(group) => onChange(group ?? root)}
            itemToStringLabel={subLabel}
            isItemEqualToValue={(a, b) => a.id === b.id}
            disabled={disabled}
          >
            <ComboboxTrigger
              aria-labelledby={`${id}-sub`}
              aria-describedby={[`${id}-sub-hint`, describedBy]
                .filter(Boolean)
                .join(' ')}
              aria-invalid={invalid || undefined}
            >
              <ComboboxValue placeholder={ONLY_ROOT}>
                {(group: ManagedWorkGroup | null) =>
                  group && group.id !== root.id ? (
                    <GroupOption group={group} groupsById={groupsById} />
                  ) : (
                    ONLY_ROOT
                  )
                }
              </ComboboxValue>
            </ComboboxTrigger>
            <ComboboxContent>
              <ComboboxInput
                aria-label="Caută un subgrup"
                placeholder="Caută un subgrup"
              />
              <ComboboxEmpty />
              <ComboboxList>
                {(group: ManagedWorkGroup) => (
                  <ComboboxItem key={group.id} value={group}>
                    {group.id === root.id ? (
                      ONLY_ROOT
                    ) : (
                      <GroupOption group={group} groupsById={groupsById} />
                    )}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <p id={`${id}-sub-hint`} className="text-sm text-muted-foreground">
            Fără subgrup, taskul aparține grupului principal.
          </p>
        </div>
      )}
    </div>
  );
}
