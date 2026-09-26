import { z } from 'zod';
import { normalizeEmail, normalizePhone, trimText } from '../normalize';
import { memberNicknameSchema } from './nickname';

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
 * The fields a Member edits on their own profile: the Nickname, the phone and
 * the avatar colour. The full name is BC's and the Moderator's (#675, R5), so
 * it is never part of this form.
 */
export const profileSchema = z.object({
  nickname: memberNicknameSchema,
  phone: phoneSchema,
  avatarColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, { error: 'invalid_avatar_color' }),
  email: emailSchema.optional(),
});

/**
 * A new sign-in address (#632): valid, and not the one the Member already
 * signs in with. Auth would take that as a silent no-op and send nothing, so
 * the form says so instead. Compared normalised on both sides: an address
 * provisioned before the sync trigger may still carry capitals.
 */
export function emailChangeSchema(currentEmail: string | null | undefined) {
  const current = normalizeEmail(currentEmail);
  return z.object({
    email: emailSchema.refine((email) => email !== current, {
      error: 'email_unchanged',
    }),
  });
}

/** Where each reason about a profile is shown. */
export const fieldForReason: Readonly<Record<string, string>> = {
  nickname_too_short: 'nickname',
  nickname_too_long: 'nickname',
  nickname_invalid: 'nickname',
  nickname_taken: 'nickname',
  phone_invalid: 'phone',
  invalid_avatar_color: 'avatarColor',
  email_invalid: 'email',
  // #632: Auth refuses an address another account already signs in with.
  email_taken: 'email',
  email_unchanged: 'email',
};
