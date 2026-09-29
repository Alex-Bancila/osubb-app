// No rank is reserved here any more. The security pass of 2026-09-27 (H1/H2)
// kept creating and re-inviting a `bc` or `moderator` account for the
// Moderator; ruling R31 (#917) gives every live BC member the same authority,
// so `invite-member` and `reinvite-member` check only their level-6 gate, and
// `public.provision_profile` still checks a leadership appointer live.

export interface ProvisionArgs {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  /** The initial Groups, appointed through the roster path (#602). */
  groupIds: number[];
  /** The inviting BC or Moderator — the Appointment's actor. */
  appointedBy: string;
}

export interface DbError {
  code?: string;
  message: string;
}

/**
 * The reasons the Appointment core (`private.appoint_group_member`) gives for
 * a Group that will not take a new Member (#949). They are the database's
 * error VOCABULARY — stable codes the app maps to copy — never its prose, so
 * they may leave the function (security pass L4). An unknown Group is not
 * here: the core answers it with the non-disclosing `group_manage_forbidden`,
 * and the functions report it as `invalid_reference`, like a missing id.
 */
export const GROUP_REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  group_archived: "Un grup ales este arhivat.",
  group_member_below_min_level:
    "Un grup ales cere un rol mai mare decât cel ales.",
  automatic_group_has_no_roster_members:
    "Un grup ales își primește membrii automat, după rol.",
};

/** True for a Group refusal reason (own keys only: never `toString`). */
export function isGroupRefusal(reason: string): boolean {
  return Object.hasOwn(GROUP_REFUSAL_MESSAGES, reason);
}

/** The first Group `provision_profile` would refuse, and why. */
export interface GroupRefusal {
  groupId: number;
  reason: string;
}

export interface InviteDeps {
  /** Validated id of the caller, or null when the token is missing/invalid. */
  callerId(): Promise<string | null>;
  /** Authoritative level from the database; 0 for missing/inactive members. */
  memberLevel(userId: string): Promise<number>;
  /** Which of these Group ids do NOT name an active Group. */
  missingGroupIds(ids: number[]): Promise<number[]>;
  /**
   * The first refusal `provision_profile` would meet placing a new Member of
   * `role` in these Groups, asked BEFORE anyone is emailed (#949,
   * `public.provision_group_refusal`); null when every Group admits them.
   * An `error` is the database's (22P02 for a rank that does not exist).
   */
  groupRefusal(
    role: string,
    groupIds: number[],
  ): Promise<{ refusal?: GroupRefusal | null; error?: DbError }>;
  /** True when a profile already uses this email. */
  profileExists(email: string): Promise<boolean>;
  /** Sends the magic-link invite; returns the new (or existing) user id. */
  inviteByEmail(
    email: string,
  ): Promise<{ userId?: string; error?: DbError & { status?: number } }>;
  provision(args: ProvisionArgs): Promise<{ error?: DbError }>;
  deleteUser(userId: string): Promise<void>;
}

export interface InviteMemberInput {
  fullName: string;
  email: string;
  role?: string;
  groupIds?: number[];
  /** The verified inviting BC or Moderator; recorded as the Appointment actor. */
  appointedBy: string;
}

export type InviteMemberResult =
  | { kind: "created"; userId: string; email: string }
  | { kind: "already_exists"; email: string }
  | { kind: "invalid_reference"; message: string }
  | { kind: "invalid_role" }
  | { kind: "group_refused"; reason: string; groupId: number | null }
  | { kind: "invite_failed"; cause?: DbError & { status?: number } }
  | { kind: "provision_failed"; details: string; cause: DbError };

/**
 * Invite and provision one member while preserving the security-sensitive
 * ordering shared by the single-member and CSV endpoints.
 */
export async function inviteMember(
  input: InviteMemberInput,
  deps: InviteDeps,
): Promise<InviteMemberResult> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const groupIds = input.groupIds ?? [];

  // Still BEFORE the invitation is sent, for the same reason as ever: a typo
  // must never mail a real person an account we then delete. It names every
  // missing id at once; the screen below names the first Group the
  // Appointment core would refuse for any other reason.
  if (groupIds.length > 0) {
    const missing = await deps.missingGroupIds(groupIds);
    if (missing.length > 0) {
      return {
        kind: "invalid_reference",
        message: `Grup inexistent: ${missing.join(", ")}.`,
      };
    }
  }

  // #949: every Group the Appointment core would refuse — archived, above the
  // rank's Minimum Level, Automatic — answered before the mail leaves, not by
  // deleting an account whose invitation is already in someone's inbox. With
  // several Groups per invitation that is the common mistake, not the rare
  // one. Asked with no Group too: it also proves the rank exists.
  const role = input.role ?? "recrut";
  const screened = await deps.groupRefusal(role, groupIds);
  if (screened.error) {
    if (screened.error.code === "22P02") return { kind: "invalid_role" };
    throw new Error("group eligibility check failed", {
      cause: screened.error,
    });
  }
  if (screened.refusal) {
    const { reason, groupId } = screened.refusal;
    return isGroupRefusal(reason)
      ? { kind: "group_refused", reason, groupId }
      : { kind: "invalid_reference", message: `Grup inexistent: ${groupId}.` };
  }

  if (await deps.profileExists(email)) {
    return { kind: "already_exists", email };
  }

  const invited = await deps.inviteByEmail(email);
  if (invited.error || !invited.userId) {
    const knownDuplicate = invited.error?.status === 422 ||
      /already been registered|already exists/i.test(
        invited.error?.message ?? "",
      );
    return knownDuplicate
      ? { kind: "already_exists", email }
      : { kind: "invite_failed", cause: invited.error };
  }

  const { error: provisionError } = await deps.provision({
    userId: invited.userId,
    fullName,
    email,
    role,
    groupIds,
    appointedBy: input.appointedBy,
  });

  if (!provisionError) {
    return { kind: "created", userId: invited.userId, email };
  }

  if (provisionError.code === "23505") {
    return { kind: "already_exists", email };
  }

  await deps.deleteUser(invited.userId);
  // A Group that changed between the screen above and the locked Appointment
  // (archived a moment ago, say) still reads as its reason.
  if (
    provisionError.code === "PT400" &&
    isGroupRefusal(provisionError.message)
  ) {
    return {
      kind: "group_refused",
      reason: provisionError.message,
      groupId: null,
    };
  }
  return {
    kind: "provision_failed",
    details: provisionError.message,
    cause: provisionError,
  };
}
