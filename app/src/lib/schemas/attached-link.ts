import { z } from 'zod';
import { charLength, emptyToNull, trimText } from '../normalize';

/**
 * An Attached Link (#673, ruling R8): a label of at most 60 characters and an
 * `http://` or `https://` address of at most 2048, both or neither. The
 * address rule is the server's to the letter — a case-sensitive prefix, as
 * `announcements_guard_text` checks it — not the browser's URL parser.
 */
export const attachedLinkSchema = z
  .object({
    label: z.string().nullish(),
    url: z.string().nullish(),
  })
  .transform((link) => ({
    label: emptyToNull(trimText(link.label)),
    url: emptyToNull(trimText(link.url)),
  }))
  .superRefine((link, ctx) => {
    const issue = (path: 'label' | 'url', message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    // Both or neither: the one left out is the one to fill in.
    if (link.label !== null && link.url === null)
      issue('url', 'link_url_required');
    if (link.url !== null && link.label === null)
      issue('label', 'link_label_required');
    if (link.label !== null && charLength(link.label) > 60)
      issue('label', 'link_label_too_long');
    if (link.url !== null) {
      if (charLength(link.url) > 2048) issue('url', 'link_url_too_long');
      else if (!/^https?:\/\//.test(link.url)) issue('url', 'link_url_invalid');
    }
  });

/** Where each reason about an Attached Link is shown. */
export const fieldForReason: Readonly<Record<string, 'label' | 'url'>> = {
  link_label_required: 'label',
  link_label_too_long: 'label',
  link_url_required: 'url',
  link_url_invalid: 'url',
  link_url_too_long: 'url',
};
