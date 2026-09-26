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
async function invitationFailure(error: unknown, fallback: string) {
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
          return new CommandError({ message: body.code }, fallback);
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
