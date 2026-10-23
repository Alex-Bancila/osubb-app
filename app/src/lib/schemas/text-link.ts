import { z } from 'zod';
import { safeHttpUrl } from '../links';

/**
 * A Text Link inside Formatted Text (ruling R60, decision 7): optional words
 * and an http(s) address, both trimmed. The address must pass `safeHttpUrl`,
 * the rule the reader links by, so `osubb.ro` and `javascript:` stay text;
 * it is refused with the Attached Link's copy. This is not the Attached Link's
 * case-sensitive prefix rule (`attached-link.ts`), which mirrors the server.
 */
export const textLinkSchema = z
  .object({ text: z.string(), url: z.string() })
  .transform(({ text, url }) => ({ text: text.trim(), url: url.trim() }))
  .superRefine(({ url }, ctx) => {
    if (safeHttpUrl(url) === null)
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'link_url_invalid',
      });
  });

/** Where each reason about a Text Link is shown. */
export const fieldForReason: Readonly<Record<string, 'url'>> = {
  link_url_invalid: 'url',
};
