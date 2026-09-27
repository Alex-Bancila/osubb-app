import { z } from 'zod';
import { charLength, trimText } from '../normalize';

/*
 * The Nickname rule in one place: the Member's own Profil form (#699) and
 * BC's and the Moderator's Administrare form (#103) both use it. It lives
 * apart from `profile.ts` and `member-identity.ts` because the latter imports
 * `emailSchema` from the former, so neither can import the other back.
 */

/**
 * `profiles_nickname_ck` as the security pass (L5) tightened it: Latin
 * letters only, so a Cyrillic or Greek look-alike cannot pass for another
 * Member. ASCII letters and digits, the Latin-1 and Latin Extended-A letters
 * (U+00C0-U+017E, less the multiplication and division signs), the Romanian
 * comma-below letters (U+0218-U+021B), a space, `.`, `-` or `_`.
 */
const NICKNAME_CHARACTERS =
  /^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017E\u0218-\u021B ._-]+$/u;

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
