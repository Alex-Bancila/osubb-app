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
} from '../../components/ui/combobox';
import type { AppointableMember } from '../../queries/groups-admin';

/**
 * The one member picker Administrare uses (dobre, 2026-09-21): typing searches
 * inside the drop-down, not in a separate field above a list, and every option
 * carries the member's name beside a small avatar — never a full-size image
 * per row.
 */
export function MemberPicker({
  ariaLabelledBy,
  members,
  value,
  onValueChange,
  placeholder = 'Alege un membru',
  disabled,
}: {
  ariaLabelledBy: string;
  members: AppointableMember[];
  value: AppointableMember | null;
  onValueChange: (member: AppointableMember | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Combobox<AppointableMember>
      items={members}
      value={value}
      disabled={disabled}
      onValueChange={(member: AppointableMember | null) =>
        onValueChange(member)
      }
      itemToStringLabel={(member) => `${member.name} · ${member.roleLabel}`}
      isItemEqualToValue={(left, right) => left.memberId === right.memberId}
    >
      <ComboboxTrigger aria-labelledby={ariaLabelledBy}>
        <ComboboxValue placeholder={placeholder}>
          {(member: AppointableMember | null) =>
            member ? (
              <MemberOption
                name={member.name}
                avatarColor={member.avatarColor}
              />
            ) : (
              placeholder
            )
          }
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput
          placeholder="Caută un membru"
          aria-label="Caută un membru"
        />
        <ComboboxEmpty />
        <ComboboxList>
          {(member: AppointableMember) => (
            <ComboboxItem key={member.memberId} value={member}>
              <MemberOption
                name={member.name}
                avatarColor={member.avatarColor}
              />
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {member.roleLabel}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
