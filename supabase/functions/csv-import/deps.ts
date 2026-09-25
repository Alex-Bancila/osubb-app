import { type InviteDeps, inviteMember } from "../_shared/member-invite.ts";
import { type AdminEnv, realDeps } from "../invite-member/deps.ts";
import type { CsvImportDeps } from "./handler.ts";

export function realCsvImportDeps(
  request: Request,
  env: AdminEnv,
): CsvImportDeps {
  const deps = realDeps(request, env);

  return {
    callerId: () => deps.callerId(),
    memberLevel: (userId) => deps.memberLevel(userId),
    activeGroups: () => deps.activeGroups(),
    invite: (input, references) => {
      // The Group set was loaded once for the whole file; asking the database
      // again per row would turn a 100-row import into 100 extra round trips.
      const cachedReferenceDeps: InviteDeps = {
        ...deps,
        missingGroupIds: (ids) =>
          Promise.resolve(ids.filter((id) => !references.has(id))),
      };
      return inviteMember(input, cachedReferenceDeps);
    },
  };
}
