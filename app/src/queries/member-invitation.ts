import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * A Member's invitation as the `reinvite-member` Edge Function reads it
 * (#773). `auth.users` is not readable from the browser, so whether a Member
 * ever signed in comes from the function, behind the same level-6 gate as the
 * re-send itself.
 */
export type InvitationStatus = {
  email: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
};

/** Whether "Retrimite invitația" applies: never signed in, still unconfirmed. */
export function invitationPending(status: InvitationStatus) {
  return status.lastSignInAt === null && !status.emailConfirmed;
}

/**
 * The function answers a refusal as `{ error, code }`; the code is the
 * reason `command-reasons` turns into copy. A gateway error has no JSON body
 * and falls back to the caller's message.
 */
async function invitationFailure(
  error: unknown,
  fallback: string,
  rename: Readonly<Record<string, string>> = {},
) {
  if (typeof error === 'object' && error !== null && 'context' in error) {
    const context = error.context;
    if (context instanceof Response) {
      try {
        const body: unknown = await context.clone().json();
        if (
          typeof body === 'object' &&
          body !== null &&
          'code' in body &&
          typeof body.code === 'string'
        )
          return new CommandError(
            { message: rename[body.code] ?? body.code },
            fallback,
          );
      } catch {
        // No JSON body: the fallback below.
      }
    }
  }
  return new CommandError(error, fallback);
}

export const REINVITE_FAILED =
  'Nu am putut retrimite invitația. Verifică internetul și încearcă din nou.';

async function invokeReinvite(body: Record<string, unknown>) {
  const result = await supabase.functions.invoke('reinvite-member', { body });
  if (result.error)
    throw await invitationFailure(result.error, REINVITE_FAILED);
  return result.data as Record<string, unknown>;
}

export async function fetchInvitationStatus(
  memberId: string,
): Promise<InvitationStatus> {
  const data = await invokeReinvite({ member_id: memberId, action: 'status' });
  return {
    email: typeof data.email === 'string' ? data.email : '',
    lastSignInAt:
      typeof data.last_sign_in_at === 'string' ? data.last_sign_in_at : null,
    emailConfirmed: data.email_confirmed === true,
  };
}

/** Mounted only on BC's or the Moderator's view of a Member's page. */
export function useInvitationStatus(memberId: string) {
  const viewerId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.members.invitation(memberId, viewerId),
    queryFn: viewerId ? () => fetchInvitationStatus(memberId) : skipToken,
    retry: false,
  });
}

export async function reinviteMember(input: {
  memberId: string;
  email: string;
}): Promise<{ email: string; emailChanged: boolean }> {
  const data = await invokeReinvite({
    member_id: input.memberId,
    email: input.email,
  });
  return {
    email: typeof data.email === 'string' ? data.email : input.email,
    emailChanged: data.email_changed === true,
  };
}

export const INVITE_FAILED =
  'Nu am putut trimite invitația. Verifică internetul și încearcă din nou.';

/**
 * Every refusal `invite-member` answers, as the reason whose copy the dialog
 * shows (#931). The function's codes are worded for its own log; a few are
 * shared with commands whose copy would misread here (`member_manage_forbidden`
 * says "modify this member"), so they are renamed to the invitation's own —
 * the pattern `applicationFormFailure` follows. `email_invalid` and
 * `full_name_required` keep their shared copy and land under their fields.
 * Anything the dialog cannot send by construction (a malformed body, a
 * legacy field) reads as the generic failure.
 */
export const INVITE_REASON: Readonly<Record<string, string>> = {
  not_signed_in: 'invite_session_expired',
  session_invalid: 'invite_session_expired',
  member_manage_forbidden: 'invite_forbidden',
  already_exists: 'invite_email_taken',
  invalid_reference: 'invite_group_unavailable',
  provision_failed: 'invite_group_refused',
  invite_failed: 'invite_failed',
  permission_check_failed: 'invite_failed',
  unexpected_error: 'invite_failed',
  method_not_allowed: 'invite_failed',
  invalid_json: 'invite_failed',
  invalid_body: 'invite_failed',
  invalid_group_ids: 'invite_failed',
  legacy_placement_fields: 'invite_failed',
};

export type InviteMemberInput = {
  email: string;
  fullName: string;
  role: string;
  /** The one Group the new Member is appointed to, if any. */
  groupId: number | null;
};

/**
 * "Invită membru" (#931): one `invite-member` call. The function sends the
 * magic link and provisions the Profile (and the Group's Appointment) in the
 * same request, and rolls the account back when provisioning is refused.
 */
export async function inviteMember(
  input: InviteMemberInput,
): Promise<{ userId: string; email: string }> {
  const result = await supabase.functions.invoke('invite-member', {
    body: {
      email: input.email,
      full_name: input.fullName,
      role: input.role,
      ...(input.groupId === null ? {} : { group_ids: [input.groupId] }),
    },
  });
  if (result.error)
    throw await invitationFailure(result.error, INVITE_FAILED, INVITE_REASON);
  const data = (result.data ?? {}) as Record<string, unknown>;
  return {
    userId: typeof data.user_id === 'string' ? data.user_id : '',
    email: typeof data.email === 'string' ? data.email : input.email,
  };
}

export function useInviteMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: inviteMember,
    onSuccess: async () => {
      // The new Member joins the Membri list (`groups.appointable`), the
      // directory, and — with a Group — that Group's roster and counts.
      await Promise.all(
        [keys.members.all, keys.groups.all].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}

export function useReinviteMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: reinviteMember,
    onSuccess: async () => {
      // A corrected address shows on the page (profiles_contact) and in the
      // directory; the invitation status keys live under members too.
      await Promise.all(
        [keys.members.all, keys.notifications.all].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
