import { z } from 'zod';
import { attachedLinksSchema, linksFieldForReason } from './attached-link';
import { optionalText, requiredText } from './text';

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
  links: attachedLinksSchema,
  code: optionalText({ max: DEAL_CODE_MAX, tooLong: 'deal_code_too_long' }),
});

export type DealValues = z.output<typeof dealSchema>;

/**
 * Where each reason is shown. A link reason from the server cannot name its
 * row, so it lands on the list (`linksFieldForReason`); the browser's own
 * issues carry their row (`links.2.url`).
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
  ...linksFieldForReason('links'),
};
