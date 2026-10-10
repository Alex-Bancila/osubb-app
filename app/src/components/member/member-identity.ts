import { parseLocalDate } from '@/lib/format';

/** What the caller already knows about a Member, shown before any read answers. */
export type MemberIdentity = {
  memberId: string;
  nickname?: string | null;
  fullName: string;
  avatarColor?: string | null;
};

/** The Nickname when the Member chose one, their full name otherwise (R5). */
export function memberDisplayName(
  nickname: string | null | undefined,
  fullName: string,
): string {
  return nickname?.trim() || fullName;
}

/**
 * How the app names a Member's Role (#963): their **Board Title**
 * (CONTEXT.md) — "Președinte", "Coordonator IT" — when a BC or BCE member
 * holds one, the Role name ("BC", "Voluntar") otherwise, and a dash when
 * neither is known. A label only: filters and sorts keep reading the Role.
 */
export function memberRoleLabel(
  roleName: string | null | undefined,
  boardTitle: string | null | undefined,
): string {
  return boardTitle?.trim() || roleName?.trim() || '—';
}

const joinedFormatter = new Intl.DateTimeFormat('ro-RO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * `Membru din 12 mar. 2024` — the join date in the short form a meta line
 * carries, or nothing when the date was never recorded.
 */
export function memberSinceLabel(joinedAt: string | null): string | null {
  const date = parseLocalDate(joinedAt);
  return date ? `Membru din ${joinedFormatter.format(date)}` : null;
}
