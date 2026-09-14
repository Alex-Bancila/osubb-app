export interface ProvisionArgs {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  deptIds: string[];
  teamIds: string[];
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
  /** Which of these ids do NOT exist in the table. */
  missingIds(table: "departments" | "teams", ids: string[]): Promise<string[]>;
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
  deptIds?: string[];
  teamIds?: string[];
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
  const deptIds = input.deptIds ?? [];
  const teamIds = input.teamIds ?? [];

  for (
    const [table, ids, label] of [
      ["departments", deptIds, "Departament inexistent"],
      ["teams", teamIds, "Echipă inexistentă"],
    ] as const
  ) {
    const missing = await deps.missingIds(table, ids);
    if (missing.length > 0) {
      return {
        kind: "invalid_reference",
        message: `${label}: ${missing.join(", ")}.`,
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
    deptIds,
    teamIds,
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
