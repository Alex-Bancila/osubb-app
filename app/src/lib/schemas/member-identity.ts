import { z } from 'zod';
import { bucharestDayKey } from '../calendar-time';
import { parseLocalDate } from '../format';
import { charLength, trimText } from '../normalize';
import { OTHER_UNIVERSITY } from '../universities';
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
 * "Invită membru" (#931, #949): the address and full name `invite-member` stores —
 * trimmed, the address lowercased — measured as `profiles` measures them.
 */
export const memberInviteSchema = z.object({
  email: emailSchema,
  fullName: requiredText({
    required: 'full_name_required',
    max: 120,
    tooLong: 'full_name_too_long',
  }),
  // The chosen Groups' ids, so a Group refusal clears once the choice changes.
  groups: z.array(z.number().int()),
});

/** Where each reason about a new invitation is shown. */
export const inviteFieldForReason: Readonly<Record<string, string>> = {
  email_invalid: 'email',
  invite_email_taken: 'email',
  full_name_required: 'fullName',
  full_name_too_long: 'fullName',
  invite_group_unavailable: 'groups',
  invite_group_archived: 'groups',
  invite_group_below_rank: 'groups',
  invite_group_automatic: 'groups',
  invite_group_refused: 'groups',
};

/**
 * A Member's join date (#932): a real calendar day (`YYYY-MM-DD`, as the
 * date input sends it), never after today in Bucharest — the Membership
 * Cutoff Date is measured against it. `today` is injectable for tests.
 */
export function memberJoinedAtSchema(
  today: string = bucharestDayKey(new Date()) ?? '',
) {
  return z.object({
    joinedAt: z.string().superRefine((value, ctx) => {
      if (value.trim() === '')
        ctx.addIssue({ code: 'custom', message: 'joined_at_required' });
      else if (!parseLocalDate(value))
        ctx.addIssue({ code: 'custom', message: 'joined_at_invalid' });
      // ISO dates compare as strings.
      else if (today && value > today)
        ctx.addIssue({ code: 'custom', message: 'joined_at_in_future' });
    }),
  });
}

/** Where each reason about a join date is shown. */
export const joinedAtFieldForReason: Readonly<Record<string, string>> = {
  joined_at_required: 'joinedAt',
  joined_at_invalid: 'joinedAt',
  joined_at_in_future: 'joinedAt',
};

/**
 * A Member's Universitate (ruling R58): either an entry of the list or, under
 * "Altă universitate", a typed name -- trimmed, then 2-120 characters, as
 * `profiles_university_length_ck` measures it. The draft is the select's value
 * and the typed name; the output is the one `university` the column stores.
 * The typed name belongs to the field a refusal is shown under.
 */
export const memberUniversitySchema = z
  .object({ option: z.string(), other: z.string() })
  .transform(({ option, other }, ctx) => {
    const university = option === OTHER_UNIVERSITY ? trimText(other) : option;
    const length = charLength(university);
    if (length < 2 || length > 120) {
      ctx.addIssue({
        code: 'custom',
        path: ['university'],
        message: 'invalid_university',
      });
      return z.NEVER;
    }
    return { university };
  });

/** Where each reason about a Universitate is shown. */
export const universityFieldForReason: Readonly<Record<string, 'university'>> =
  { invalid_university: 'university' };
