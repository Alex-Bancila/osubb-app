import { z } from 'zod';
import { charLength, trimText } from '../normalize';
import { requiredText } from './text';

/**
 * `[[:alnum:] ._-]` as #675's `profiles_nickname_ck` reads it: any letter or
 * digit (diacritics included), a space, `.`, `-` or `_`.
 */
const NICKNAME_CHARACTERS = /^[\p{L}\p{N} ._-]+$/u;

/**
 * A Nickname as `private.guard_profile_nickname` (#675, ruling R5) stores it:
 * NFC-normalised and trimmed before it is measured, blank is none (the full
 * name stands in), otherwise 2–24 characters of letters, digits, spaces, `.`,
 * `-` or `_`. The reasons are the server's, raised in the server's order;
 * `nickname_taken` is the server's alone, since only it sees every Nickname.
 */
export const memberNicknameSchema = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    const nickname = trimText(value?.normalize('NFC'));
    if (nickname === '') return null;
    const length = charLength(nickname);
    const reason =
      length < 2
        ? 'nickname_too_short'
        : length > 24
          ? 'nickname_too_long'
          : NICKNAME_CHARACTERS.test(nickname)
            ? undefined
            : 'nickname_invalid';
    if (reason !== undefined) {
      ctx.addIssue({ code: 'custom', message: reason });
      return z.NEVER;
    }
    return nickname;
  });

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
