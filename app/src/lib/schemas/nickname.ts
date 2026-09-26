import { z } from 'zod';
import { charLength, trimText } from '../normalize';

/*
 * The Nickname rule in one place: the Member's own Profil form (#699) and
 * BC's and the Moderator's Administrare form (#103) both use it. It lives
 * apart from `profile.ts` and `member-identity.ts` because the latter imports
 * `emailSchema` from the former, so neither can import the other back.
 */

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
