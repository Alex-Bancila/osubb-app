import { useEffect, useRef } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '../ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  GroupOption,
  groupOptionLabel,
} from '../ui/combobox';
import { chosenGroupsLabel } from './chosen-groups-label';
import type { GroupFilterOption } from './GroupFilterCombobox';

/**
 * Several Groups from the searchable `Name · Parent` list (#949): the
 * sibling of `GroupFilterCombobox` for a form that places one Member in more
 * than one Group. The list stays open while Groups are ticked; the chosen
 * ones show under the trigger as chips, each removable on its own. Removing
 * one moves focus to the chip now in its place, else back to the trigger.
 * The visible label stays with the caller, passed as `ariaLabelledBy`.
 */
export function GroupMultiCombobox<G extends GroupFilterOption>({
  ariaLabelledBy,
  ariaDescribedBy,
  groups,
  groupsById,
  value,
  onValueChange,
  placeholder,
  disabled,
}: {
  ariaLabelledBy: string;
  ariaDescribedBy?: string;
  groups: G[];
  groupsById: ReadonlyMap<number, Pick<G, 'name'>>;
  value: readonly G[];
  onValueChange: (groups: G[]) => void;
  /** Trigger text with nothing chosen, e.g. "Niciun grup". */
  placeholder: string;
  disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const chipRow = useRef<HTMLUListElement>(null);
  const refocus = useRef<{ index: number; id: number } | null>(null);
  const label = (group: G) => groupOptionLabel(group, groupsById);

  useEffect(() => {
    const pending = refocus.current;
    if (!pending || value.some((group) => group.id === pending.id)) return;
    refocus.current = null;
    const chips = [
      ...(chipRow.current?.querySelectorAll<HTMLElement>('button') ?? []),
    ];
    (
      chips[Math.min(pending.index, chips.length - 1)] ?? trigger.current
    )?.focus();
  });

  return (
    <div className="grid gap-2">
      <Combobox
        multiple
        items={groups}
        value={[...value]}
        onValueChange={(next: G[]) => onValueChange(next)}
        itemToStringLabel={label}
        // A reloaded list holds new objects for the same Groups.
        isItemEqualToValue={(item: G, chosen: G) => item.id === chosen.id}
        disabled={disabled}
      >
        <ComboboxTrigger
          ref={trigger}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
        >
          {value.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            chosenGroupsLabel(value.length)
          )}
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxInput
            placeholder="Caută un grup"
            aria-label="Caută un grup"
          />
          <ComboboxEmpty />
          <ComboboxList>
            {(group: G) => (
              <ComboboxItem key={group.id} value={group}>
                <GroupOption group={group} groupsById={groupsById} />
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {value.length > 0 && (
        <ul
          ref={chipRow}
          aria-label="Grupuri alese"
          className="m-0 flex min-w-0 list-none flex-wrap gap-2 p-0"
        >
          {value.map((group, index) => (
            <li key={group.id} className="max-w-full min-w-0">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="max-w-full min-w-0"
                disabled={disabled}
                aria-label={`Scoate grupul ${label(group)}`}
                onClick={() => {
                  refocus.current = { index, id: group.id };
                  onValueChange(value.filter((row) => row.id !== group.id));
                }}
              >
                <span className="truncate">{label(group)}</span>
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
