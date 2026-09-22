import { XIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
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
  MemberOption,
  groupOptionLabel,
} from '../../components/ui/combobox';
import {
  eligibleExecutors,
  filterExecutors,
  useDirectExecutors,
  type DirectExecutor,
  type DirectExecutorGroup,
} from '../../queries/direct-executors';

/** Parents before their children, siblings alphabetically. */
function compareInTreeOrder(
  a: DirectExecutorGroup,
  b: DirectExecutorGroup,
  groupsById: ReadonlyMap<number, DirectExecutorGroup>,
) {
  const names = (group: DirectExecutorGroup) =>
    group.path.map((id) => groupsById.get(id)?.name ?? '');
  const left = names(a);
  const right = names(b);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const order = (left[i] ?? '').localeCompare(right[i] ?? '', 'ro');
    if (order) return order;
  }
  return left.length - right.length || a.id - b.id;
}

/**
 * Picks one Executor for a direct Task: a searchable member dropdown plus an
 * optional Group filter. Only Members at or above the Origin Group's Minimum
 * Level are offered; the Group filter narrows the list and never widens it.
 */
export function DirectExecutorSelector({
  originGroupId,
  value,
  onChange,
  disabled = false,
}: {
  originGroupId: number;
  value: string | null;
  onChange: (memberId: string | null) => void;
  disabled?: boolean;
}) {
  const query = useDirectExecutors();
  const id = useId();
  const [groupId, setGroupId] = useState<number | null>(null);
  const data = query.data;
  const eligible = useMemo(
    () => (data ? eligibleExecutors(data, originGroupId) : []),
    [data, originGroupId],
  );
  const valid =
    value === null || eligible.some((member) => member.id === value);
  useEffect(() => {
    // The Group filter never invalidates the selected Executor. Wait for a
    // successful authoritative read before clearing a now-ineligible member.
    if (query.isSuccess && !valid) onChange(null);
  }, [query.isSuccess, valid, onChange]);
  const groupsById = useMemo(
    () => new Map((data?.groups ?? []).map((group) => [group.id, group])),
    [data],
  );
  const groupChoices = useMemo(
    () =>
      (data?.groups ?? [])
        .filter((group) => group.status === 'active')
        .sort((a, b) => compareInTreeOrder(a, b, groupsById)),
    [data, groupsById],
  );

  if (query.isPending) return <p role="status">Se încarcă membrii…</p>;
  if (query.isError || !data)
    return (
      <div role="alert" className="space-y-2">
        <p>Nu am putut încărca membrii.</p>
        <Button type="button" variant="outline" onClick={() => query.refetch()}>
          Reîncarcă lista
        </Button>
      </div>
    );

  const filtered = filterExecutors(data, originGroupId, groupId);
  const selected = eligible.find((member) => member.id === value) ?? null;
  // A chosen member stays in the list when the Group filter hides them, so
  // the dropdown and the submitted ID never disagree.
  const options =
    selected && !filtered.includes(selected)
      ? [selected, ...filtered]
      : filtered;
  const filterGroup = groupId === null ? null : groupsById.get(groupId);

  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3">
      <div className="grid gap-1.5">
        <label id={`${id}-member`} className="text-sm font-medium">
          Executor
        </label>
        <Combobox<DirectExecutor>
          items={options}
          value={selected}
          onValueChange={(member) => onChange(member?.id ?? null)}
          itemToStringLabel={(member) => member.name}
          isItemEqualToValue={(a, b) => a.id === b.id}
          disabled={disabled || !eligible.length}
        >
          <ComboboxTrigger aria-labelledby={`${id}-member`}>
            <ComboboxValue placeholder="Alege un membru">
              {(member: DirectExecutor | null) =>
                member ? (
                  <MemberOption
                    name={member.name}
                    avatarColor={member.avatarColor}
                  />
                ) : (
                  'Alege un membru'
                )
              }
            </ComboboxValue>
          </ComboboxTrigger>
          <ComboboxContent>
            <ComboboxInput
              aria-label="Caută un membru"
              placeholder="Caută după nume"
            />
            <ComboboxEmpty>
              {filterGroup
                ? 'Niciun membru eligibil în acest grup.'
                : 'Niciun membru găsit.'}
            </ComboboxEmpty>
            <ComboboxList>
              {(member: DirectExecutor) => (
                <ComboboxItem key={member.id} value={member}>
                  <MemberOption
                    name={member.name}
                    avatarColor={member.avatarColor}
                  />
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        {!eligible.length && (
          <p role="status" className="text-sm text-muted-foreground">
            Niciun membru nu are nivelul cerut de acest grup.
          </p>
        )}
      </div>
      {eligible.length > 0 && (
        <div className="grid gap-1.5">
          <label id={`${id}-group`} className="text-sm font-medium">
            Arată doar membrii din grupul
          </label>
          <div className="flex min-w-0 gap-2">
            <Combobox<DirectExecutorGroup>
              items={groupChoices}
              value={filterGroup ?? null}
              onValueChange={(group) => setGroupId(group?.id ?? null)}
              itemToStringLabel={(group) => groupOptionLabel(group, groupsById)}
              isItemEqualToValue={(a, b) => a.id === b.id}
              disabled={disabled}
            >
              <ComboboxTrigger aria-labelledby={`${id}-group`}>
                <ComboboxValue placeholder="Toate grupurile">
                  {(group: DirectExecutorGroup | null) =>
                    group ? (
                      <GroupOption group={group} groupsById={groupsById} />
                    ) : (
                      'Toate grupurile'
                    )
                  }
                </ComboboxValue>
              </ComboboxTrigger>
              <ComboboxContent>
                <ComboboxInput
                  aria-label="Caută un grup"
                  placeholder="Caută un grup"
                />
                <ComboboxEmpty />
                <ComboboxList>
                  {(group: DirectExecutorGroup) => (
                    <ComboboxItem key={group.id} value={group}>
                      <GroupOption group={group} groupsById={groupsById} />
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            {filterGroup && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setGroupId(null)}
              >
                <XIcon aria-hidden="true" />
                <span className="sr-only">Arată toate grupurile</span>
              </Button>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}
