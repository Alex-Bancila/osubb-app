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

/** The row that stands for "nobody" when a picker offers an empty choice. */
function noneOption(label: string): AppointableMember {
  return {
    memberId: '',
    name: label,
    avatarColor: null,
    status: '',
    roleId: null,
    roleLabel: '',
    level: 0,
  };
}

/**
 * The one member picker Administrare uses (dobre, 2026-09-21): typing searches
 * inside the drop-down, not in a separate field above a list, and every option
 * carries the member's name beside a small avatar — never a full-size image
 * per row.
 *
 * With `noneLabel` the choice is optional: the first row is that label, it is
 * what the trigger shows while nobody is chosen, and picking it hands back
 * `null` — so a choice made by mistake can be taken back in the same list.
 */
export function MemberPicker({
  ariaLabelledBy,
  ariaDescribedBy,
  members,
  value,
  onValueChange,
  placeholder = 'Alege un membru',
  noneLabel,
  disabled,
}: {
  ariaLabelledBy: string;
  ariaDescribedBy?: string;
  members: AppointableMember[];
  value: AppointableMember | null;
  onValueChange: (member: AppointableMember | null) => void;
  placeholder?: string;
  /** An explicit empty choice, e.g. "Fără manager direct". */
  noneLabel?: string;
  disabled?: boolean;
}) {
  const none = noneLabel ? noneOption(noneLabel) : null;
  const items = none ? [none, ...members] : members;
  return (
    <Combobox<AppointableMember>
      items={items}
      value={value ?? none}
      disabled={disabled}
      onValueChange={(member: AppointableMember | null) =>
        onValueChange(member && member.memberId !== '' ? member : null)
      }
      itemToStringLabel={(member) =>
        member.memberId === ''
          ? member.name
          : `${member.name} · ${member.roleLabel}`
      }
      isItemEqualToValue={(left, right) => left.memberId === right.memberId}
    >
      <ComboboxTrigger
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
      >
        <ComboboxValue placeholder={placeholder}>
          {(member: AppointableMember | null) =>
            member && member.memberId !== '' ? (
              <MemberOption
                name={member.name}
                avatarColor={member.avatarColor}
              />
            ) : (
              (noneLabel ?? placeholder)
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
          {(member: AppointableMember) =>
            member.memberId === '' ? (
              <ComboboxItem
                key="none"
                value={member}
                className="text-muted-foreground"
              >
                {member.name}
              </ComboboxItem>
            ) : (
              <ComboboxItem key={member.memberId} value={member}>
                <MemberOption
                  name={member.name}
                  avatarColor={member.avatarColor}
                />
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {member.roleLabel}
                </span>
              </ComboboxItem>
            )
          }
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
