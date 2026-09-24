import { z } from 'zod';
import {
  charLength,
  normalizeEmail,
  normalizePhone,
  trimText,
} from '../normalize';

/**
 * A phone number as `profiles_normalize_phone` stores it (#673, ruling R8):
 * blank is none, anything else is E.164 or refused as `phone_invalid`.
 */
export const phoneSchema = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    if (trimText(value) === '') return null;
    const phone = normalizePhone(value);
    if (phone === null) {
      ctx.addIssue({ code: 'custom', message: 'phone_invalid' });
      return z.NEVER;
    }
    return phone;
  });

/** An address, trimmed and lowercased before it is checked (R8). */
export const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(z.email({ error: 'email_invalid' }));

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
export const nicknameSchema = z
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
 * The fields a Member edits on their own profile: the Nickname, the phone and
 * the avatar colour. The full name is BC's and the Moderator's (#675, R5), so
 * it is never part of this form.
 */
export const profileSchema = z.object({
  nickname: nicknameSchema,
  phone: phoneSchema,
  avatarColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, { error: 'invalid_avatar_color' }),
  email: emailSchema.optional(),
});

/** Where each reason about a profile is shown. */
export const fieldForReason: Readonly<Record<string, string>> = {
  nickname_too_short: 'nickname',
  nickname_too_long: 'nickname',
  nickname_invalid: 'nickname',
  nickname_taken: 'nickname',
  phone_invalid: 'phone',
  invalid_avatar_color: 'avatarColor',
  email_invalid: 'email',
};
