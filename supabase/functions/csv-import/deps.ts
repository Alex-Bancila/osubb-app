import { type InviteDeps, inviteMember } from "../_shared/member-invite.ts";
import { realDeps } from "../invite-member/deps.ts";
import type { CsvImportDeps } from "./handler.ts";

export function realCsvImportDeps(request: Request): CsvImportDeps {
  const deps = realDeps(request);

  return {
    callerId: () => deps.callerId(),
    memberLevel: (userId) => deps.memberLevel(userId),
    referenceIds: (table) => deps.referenceIds(table),
    invite: (input, references) => {
      const cachedReferenceDeps: InviteDeps = {
        ...deps,
        missingIds: (table, ids) => {
          const existing = table === "departments"
            ? references.departmentIds
            : references.teamIds;
          return Promise.resolve(ids.filter((id) => !existing.has(id)));
        },
      };
      return inviteMember(input, cachedReferenceDeps);
    },
  };
}
