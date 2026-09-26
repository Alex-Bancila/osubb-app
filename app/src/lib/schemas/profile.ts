import { z } from 'zod';
import { normalizeEmail, normalizePhone, trimText } from '../normalize';
import { requiredText } from './text';

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
 * The member's own profile fields. The full name is only sent by BC and the
 * Moderator (#675); the Nickname and its own rules belong to #699.
 */
export const profileSchema = z.object({
  fullName: requiredText({ required: 'full_name_required' }).optional(),
  phone: phoneSchema,
  avatarColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, { error: 'invalid_avatar_color' }),
  email: emailSchema.optional(),
});

/** Where each reason about a profile is shown. */
export const fieldForReason: Readonly<Record<string, string>> = {
  phone_invalid: 'phone',
  full_name_required: 'fullName',
  invalid_avatar_color: 'avatarColor',
  email_invalid: 'email',
};
