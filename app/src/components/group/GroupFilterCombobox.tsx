import type { ReactNode } from 'react';
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
} from '../ui/combobox';

/** The part of a Group this picker needs; matches `GroupOption`'s own shape. */
export type GroupFilterOption = {
  id: number;
  name: string;
  path: readonly number[];
};

/**
 * The searchable `Name · Parent` Group picker (#560's leadership filter and
 * #542's member directory wrote this twice; #646 extracts the one shared
 * version). It owns only the Combobox itself — the visible "Grup" label and
 * any wrapping layout stay with the caller, which passes `ariaLabelledBy`
 * pointing at that label so the trigger keeps its accessible name.
 */
export function GroupFilterCombobox<G extends GroupFilterOption>({
  ariaLabelledBy,
  groups,
  groupsById,
  value,
  onValueChange,
  placeholder,
  itemToStringLabel,
  renderItem,
  disabled,
}: {
  ariaLabelledBy: string;
  groups: G[];
  groupsById: ReadonlyMap<number, Pick<G, 'name'>>;
  value: G | null;
  onValueChange: (group: G | null) => void;
  /** Trigger placeholder shown with nothing selected, e.g. "Toate grupurile" or "Adaugă un grup". */
  placeholder: string;
  /** Defaults to `groupOptionLabel(group, groupsById)`; override to fold in
   *  extra text (e.g. an archived suffix) so the search box matches it too. */
  itemToStringLabel?: (group: G) => string;
  /** Defaults to `<GroupOption />`; override to add extra per-row content
   *  (e.g. an "arhivat" badge) beside the name and parent. */
  renderItem?: (group: G) => ReactNode;
  /** Nothing to choose yet, e.g. a Subgrup before its root is chosen. */
  disabled?: boolean;
}) {
  const stringLabel =
    itemToStringLabel ?? ((group: G) => groupOptionLabel(group, groupsById));
  return (
    <Combobox
      items={groups}
      value={value}
      // Base UI's onValueChange also passes event details as a second
      // argument; callers only ever want the selected Group (or null).
      onValueChange={(group: G | null) => onValueChange(group)}
      itemToStringLabel={stringLabel}
      disabled={disabled}
    >
      <ComboboxTrigger aria-labelledby={ariaLabelledBy}>
        <ComboboxValue placeholder={placeholder} />
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput placeholder="Caută un grup" aria-label="Caută un grup" />
        <ComboboxEmpty />
        <ComboboxList>
          {(group: G) => (
            <ComboboxItem key={group.id} value={group}>
              {renderItem ? (
                renderItem(group)
              ) : (
                <GroupOption group={group} groupsById={groupsById} />
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
