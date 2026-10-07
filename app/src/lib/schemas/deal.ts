import { z } from 'zod';
import {
  attachedLinkSchema,
  fieldForReason as linkFieldForReason,
} from './attached-link';
import { optionalText, requiredText } from './text';

/** At most this many Attached Links on a Deal (ruling R46). */
export const DEAL_LINK_LIMIT = 5;

/** The Deal Code's limit, trimmed (`deal_code_too_long`). */
export const DEAL_CODE_MAX = 80;

/**
 * A Deal (ruling R45), as the announcement guards store it: the
 * Announcement's title and body rules (`announcements_guard_text`), an
 * optional Termen that is not in the past, up to five Attached Links, each
 * label-and-address pair validated as one, and an optional Deal Code of at
 * most 80 characters. The Group, Audience, Minimum Level, Priority and pin are
 * not the author's to choose: every Deal is the Organization's, for everyone.
 */
export const dealSchema = z.object({
  title: requiredText({
    required: 'title_required',
    min: 3,
    tooShort: 'title_too_short',
    max: 120,
    tooLong: 'title_too_long',
  }),
  body: requiredText({
    required: 'body_required',
    max: 2000,
    tooLong: 'body_too_long',
  }),
  deadline: z
    .string()
    .nullable()
    .superRefine((deadline, ctx) => {
      if (deadline === null) return;
      const time = deadline ? Date.parse(deadline) : Number.NaN;
      if (!Number.isFinite(time))
        ctx.addIssue({ code: 'custom', message: 'deadline_invalid' });
      else if (time < Date.now())
        ctx.addIssue({ code: 'custom', message: 'deadline_in_past' });
    }),
  links: z
    .array(attachedLinkSchema)
    .max(DEAL_LINK_LIMIT, 'too_many_links')
    // An empty row is no link: only the filled pairs are stored.
    .transform((links) =>
      links.flatMap((link) =>
        link.label !== null && link.url !== null
          ? [{ label: link.label, url: link.url }]
          : [],
      ),
    ),
  code: optionalText({ max: DEAL_CODE_MAX, tooLong: 'deal_code_too_long' }),
});

export type DealValues = z.output<typeof dealSchema>;

/**
 * Where each reason is shown. A link reason the server raises cannot say
 * which row it is about, so it lands on the first row's field.
 */
export const dealFieldForReason: Readonly<Record<string, string>> = {
  title_required: 'title',
  title_too_short: 'title',
  title_too_long: 'title',
  body_required: 'body',
  body_too_long: 'body',
  deadline_invalid: 'deadline',
  deadline_in_past: 'deadline',
  deal_code_too_long: 'code',
  too_many_links: 'links',
  ...Object.fromEntries(
    Object.entries(linkFieldForReason).map(([reason, field]) => [
      reason,
      `links.0.${field}`,
    ]),
  ),
};
