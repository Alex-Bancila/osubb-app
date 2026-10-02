import { createClient } from "@supabase/supabase-js";
import { type InviteDeps, inviteMember } from "../_shared/member-invite.ts";
import type { KnownAddress, SheetGroup } from "../_shared/volunteer-sheet.ts";
import {
  type AdminEnv,
  type ClientFactory,
  realDeps,
} from "../invite-member/deps.ts";
import type { CsvImportDeps } from "./handler.ts";
import type { ImportMemberResult, VolunteerImportDeps } from "./volunteers.ts";

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
    volunteers: realVolunteerImportDeps(env),
  };
}

const PAGE = 1000;

/**
 * #991: the volunteer import's port. Every call runs with the secret key
 * (service_role), after the handler has checked the caller's level 6 in the
 * database; public.import_member re-checks the importer live.
 */
export function realVolunteerImportDeps(
  env: AdminEnv,
  create: ClientFactory = createClient,
): VolunteerImportDeps {
  const admin = create(env.url, env.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    async importGroups() {
      // PostgREST caps rows per request: walk ordered pages.
      const groups: SheetGroup[] = [];
      for (let from = 0;; from += PAGE) {
        const { data, error } = await admin.from("groups")
          .select("id, name, short, parent_id, is_organization")
          .eq("status", "active")
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const page = data ?? [];
        for (const row of page) {
          groups.push({
            id: row.id,
            name: row.name,
            short: row.short,
            topLevel: row.parent_id === null,
            isOrganization: row.is_organization,
          });
        }
        if (page.length < PAGE) return groups;
      }
    },

    async boardGroupId() {
      const { data, error } = await admin.from("org_settings")
        .select("value")
        .eq("key", "board_group_id")
        .maybeSingle();
      if (error) throw error;
      const value = data?.value;
      return typeof value === "string" && /^[1-9][0-9]{0,17}$/.test(value)
        ? Number(value)
        : null;
    },

    async lookupAddresses(emails) {
      const known = new Map<string, KnownAddress>();
      if (emails.length === 0) return known;
      const { data, error } = await admin.rpc("import_member_lookup", {
        p_emails: emails,
      });
      if (error) throw error;
      for (
        const row of (data ?? []) as Array<{
          email: string;
          member_id: string | null;
          imported: boolean;
          orphan_user_id: string | null;
        }>
      ) {
        known.set(row.email, {
          memberId: row.member_id,
          imported: row.imported,
          orphanUserId: row.orphan_user_id,
        });
      }
      return known;
    },

    async createAccount(email) {
      // The admin API sends no confirmation or invitation email; the address
      // stays unconfirmed, so a later invitation (send-invitations,
      // reinvite-member) reaches this same account (verified against the
      // local Auth server: no mail on create, one on the invitation).
      const { data, error } = await admin.auth.admin.createUser({
        email,
        email_confirm: false,
      });
      if (error || !data?.user) {
        return {
          error: {
            message: error?.message ?? "create failed",
            status: error?.status,
            code: error?.code,
          },
        };
      }
      return { userId: data.user.id };
    },

    async importMember(args) {
      const { data, error } = await admin.rpc("import_member", {
        p_user_id: args.userId,
        p_full_name: args.fullName,
        p_email: args.email,
        p_role: args.rank,
        p_phone: args.phone,
        p_joined_at: args.joinedAt,
        p_placements: args.placements,
        p_problems: args.problems,
        p_sheet_row: args.sheetRow,
        p_imported_by: args.importedBy,
      });
      if (error) return { error: { code: error.code, message: error.message } };
      return { result: data as ImportMemberResult };
    },

    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
  };
}
