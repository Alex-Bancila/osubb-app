import { memberDisplayName } from '../../components/member/member-identity';
import {
  assignmentLabel,
  type AssignmentHolders,
  type SetBcAssignmentInput,
} from '../../queries/bc-assignments';
import type { AppointableMember } from '../../queries/groups-admin';

/** The BC members Atribuții go to (R44): active, level 6. */
export function bcMembers<T extends { level: number; status: string }>(
  members: readonly T[],
): T[] {
  return members.filter(
    (member) => member.status === 'activ' && member.level === 6,
  );
}

/**
 * What ticking or unticking a box asks before it happens (R44): giving an
 * Atribuție that another BC member holds moves it, so it is confirmed; taking
 * one back dissolves its team, so that is confirmed too. Giving a free one
 * needs no question.
 */
export type AssignmentChange = {
  input: SetBcAssignmentInput;
  /** Null when the change needs no confirmation. */
  confirm: { title: string; description: string; action: string } | null;
};

export function assignmentChange(
  assignment: string,
  member: Pick<AppointableMember, 'memberId' | 'name' | 'nickname'>,
  checked: boolean,
  holders: AssignmentHolders,
  nameOf: (memberId: string) => string,
): AssignmentChange {
  const label = assignmentLabel(assignment);
  const name = memberDisplayName(member.nickname, member.name);
  if (!checked)
    return {
      input: { assignment, memberId: member.memberId, granted: false },
      confirm: {
        title: 'Retragi atribuția?',
        description: `${label} — ${name}. Echipa se dizolvă; deal-urile rămân.`,
        action: 'Retrage atribuția',
      },
    };
  const holder = holders.get(assignment);
  if (holder && holder !== member.memberId)
    return {
      input: {
        assignment,
        memberId: member.memberId,
        granted: true,
        move: true,
      },
      confirm: {
        title: `Muți atribuția de la ${nameOf(holder)} la ${name}?`,
        description: `${label}. Echipa rămâne aceeași.`,
        action: 'Mută atribuția',
      },
    };
  return {
    input: { assignment, memberId: member.memberId, granted: true },
    confirm: null,
  };
}
