import { supabase } from './supabase';

/**
 * What became of a request to re-send an invitation (#968). `sent` means the
 * function took the request — whether an email left is deliberately not said,
 * so the login page shows the same screen as for any address.
 */
export type InvitationRequestOutcome = 'sent' | 'rate_limited' | 'failed';

/**
 * The login page's answer to Auth's `signup_disabled`, which is what Auth
 * says to a magic-link request for an account that was invited but never
 * confirmed: ask the `request-invitation` Edge Function to re-send that
 * invitation. The function answers 202 for every address, 429 when this
 * network has asked too often; anything else is a failure the page must
 * report rather than show as sent.
 */
export async function requestInvitation(
  email: string,
): Promise<InvitationRequestOutcome> {
  try {
    const { error } = await supabase.functions.invoke('request-invitation', {
      body: { email },
    });
    if (!error) return 'sent';
    // A refusal carries the function's Response (FunctionsHttpError), the
    // same way `member-invitation.ts` reads `invite-member`'s.
    if (
      typeof error === 'object' &&
      error !== null &&
      'context' in error &&
      error.context instanceof Response &&
      error.context.status === 429
    )
      return 'rate_limited';
    return 'failed';
  } catch {
    return 'failed';
  }
}
