import { z } from 'zod';
import { memberNicknameSchema } from './nickname';
import { emailSchema } from './profile';
import { requiredText } from './text';

/**
 * The names BC and the Moderator edit on a Member's Administrare page (#103,
 * ruling R5): the Nickname, and the full name only they may change
 * (`guard_profile_privileged_columns`, #675).
 */
export const memberIdentitySchema = z.object({
  nickname: memberNicknameSchema,
  // Security pass 2026-09-27: profiles_full_name_length_ck (at most 120).
  fullName: requiredText({
    required: 'full_name_required',
    max: 120,
    tooLong: 'full_name_too_long',
  }),
});

/** Where each reason about a Member's names is shown. */
export const fieldForReason: Readonly<Record<string, string>> = {
  nickname_too_short: 'nickname',
  nickname_too_long: 'nickname',
  nickname_invalid: 'nickname',
  nickname_taken: 'nickname',
  full_name_required: 'fullName',
  full_name_too_long: 'fullName',
};

/**
 * The address a re-sent invitation goes to (#773): trimmed and lowercased, as
 * `reinvite-member` stores it in both `auth.users` and `profiles`.
 */
export const memberInvitationSchema = z.object({ email: emailSchema });

/** Where each reason about a re-sent invitation is shown. */
export const invitationFieldForReason: Readonly<Record<string, string>> = {
  email_invalid: 'email',
  email_taken: 'email',
};

/**
 * "Invită membru" (#931): the address and full name `invite-member` stores —
 * trimmed, the address lowercased — measured as `profiles` measures them.
 */
export const memberInviteSchema = z.object({
  email: emailSchema,
  fullName: requiredText({
    required: 'full_name_required',
    max: 120,
    tooLong: 'full_name_too_long',
  }),
});

/** Where each reason about a new invitation is shown. */
export const inviteFieldForReason: Readonly<Record<string, string>> = {
  email_invalid: 'email',
  invite_email_taken: 'email',
  full_name_required: 'fullName',
  full_name_too_long: 'fullName',
  invite_group_unavailable: 'group',
  invite_group_refused: 'group',
};
