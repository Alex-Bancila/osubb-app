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

export interface InviteDeps {
  /** Validated id of the caller, or null when the token is missing/invalid. */
  callerId(): Promise<string | null>;
  /** Authoritative level from the database; 0 for missing/inactive members. */
  memberLevel(userId: string): Promise<number>;
  /** Which of these Group ids do NOT name an active Group. */
  missingGroupIds(ids: number[]): Promise<number[]>;
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
  // must never mail a real person an account we then delete. The Appointment
  // core refuses far more than a missing id (archived, Automatic, below the
  // Minimum Level) and those refusals are answered by the rollback below —
  // this check only keeps the cheapest, commonest mistake out of the mailbox.
  if (groupIds.length > 0) {
    const missing = await deps.missingGroupIds(groupIds);
    if (missing.length > 0) {
      return {
        kind: "invalid_reference",
        message: `Grup inexistent: ${missing.join(", ")}.`,
      };
    }
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
    role: input.role ?? "recrut",
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
  return {
    kind: "provision_failed",
    details: provisionError.message,
    cause: provisionError,
  };
}
