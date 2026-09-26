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
  fullName: requiredText({ required: 'full_name_required' }),
});

/** Where each reason about a Member's names is shown. */
export const fieldForReason: Readonly<Record<string, string>> = {
  nickname_too_short: 'nickname',
  nickname_too_long: 'nickname',
  nickname_invalid: 'nickname',
  nickname_taken: 'nickname',
  full_name_required: 'fullName',
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
