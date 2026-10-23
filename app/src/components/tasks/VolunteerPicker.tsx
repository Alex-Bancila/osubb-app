import { useEffect, useId, useMemo } from 'react';
import { memberComboboxFilter } from '../../lib/member-search';
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
  MemberOption,
} from '../ui/combobox';
import {
  useCompletedTaskExecutors,
  type CompletedTaskVolunteer,
} from '../../queries/completed-tasks';

/** Typing matches the Nickname and the full name alike (#1100). */
const volunteerFilter = memberComboboxFilter(
  (member: CompletedTaskVolunteer) => ({
    nickname: member.nickname,
    fullName: member.fullName,
  }),
);

/**
 * Voluntar: the Members the caller may credit in the chosen Group
 * (`completed_task_executors`: any active Member at or above its Minimum
 * Level, member or not -- ruling R51), re-read when the Group changes. A volunteer
 * the new Group does not offer is cleared once that read succeeds. One
 * picker on the completed-Task form; one per copy in the executors dialog of
 * n finished Tasks (spec 2026-10-11, Part E), labelled "Exemplarul i" there.
 * `excludeIds` keeps other pickers' choices out of this list; the Part E
 * dialog passes none, since the same person may be credited several times.
 */
export function VolunteerPicker({
  groupId,
  value,
  onChange,
  disabled = false,
  invalid = false,
  errorId,
  label = 'Voluntar',
  excludeIds = [],
}: {
  groupId: number | null;
  value: string | null;
  onChange: (memberId: string | null) => void;
  disabled?: boolean;
  invalid?: boolean;
  errorId?: string;
  label?: string;
  excludeIds?: readonly string[];
}) {
  const id = useId();
  const query = useCompletedTaskExecutors(groupId);
  const members = useMemo(() => {
    const all = query.data ?? [];
    return excludeIds.length
      ? all.filter(
          (member) => member.id === value || !excludeIds.includes(member.id),
        )
      : all;
  }, [query.data, excludeIds, value]);
  const selected = members.find((member) => member.id === value) ?? null;
  const offered = value === null || selected !== null;
  useEffect(() => {
    if (query.isSuccess && !offered) onChange(null);
  }, [query.isSuccess, offered, onChange]);
  return (
    <>
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      {groupId === null ? (
        <p className="m-0 text-sm text-muted-foreground">
          Alege întâi grupul: lista arată pe cine poți credita acolo.
        </p>
      ) : query.isPending ? (
        <p role="status" className="m-0 text-sm">
          Se încarcă membrii…
        </p>
      ) : query.isError ? (
        <div role="alert" className="space-y-2 text-sm">
          <p className="m-0">Nu am putut încărca membrii.</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            Reîncarcă lista
          </Button>
        </div>
      ) : (
        <Combobox<CompletedTaskVolunteer>
          items={members}
          value={selected}
          onValueChange={(member) => onChange(member?.id ?? null)}
          itemToStringLabel={(member) => member.name}
          filter={volunteerFilter}
          isItemEqualToValue={(a, b) => a.id === b.id}
          disabled={disabled || !members.length}
        >
          <ComboboxTrigger
            aria-labelledby={`${id}-label`}
            aria-required="true"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
          >
            <ComboboxValue
              placeholder={
                members.length
                  ? 'Alege un membru'
                  : 'Niciun membru eligibil în acest grup'
              }
            >
              {(member: CompletedTaskVolunteer | null) =>
                member ? (
                  <MemberOption
                    name={member.name}
                    avatarColor={member.avatarColor}
                  />
                ) : members.length ? (
                  'Alege un membru'
                ) : (
                  'Niciun membru eligibil în acest grup'
                )
              }
            </ComboboxValue>
          </ComboboxTrigger>
          <ComboboxContent>
            <ComboboxInput
              aria-label="Caută un membru"
              placeholder="Caută după nume"
            />
            <ComboboxEmpty>Niciun membru găsit.</ComboboxEmpty>
            <ComboboxList>
              {(member: CompletedTaskVolunteer) => (
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
      )}
    </>
  );
}
