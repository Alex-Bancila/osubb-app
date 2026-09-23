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
