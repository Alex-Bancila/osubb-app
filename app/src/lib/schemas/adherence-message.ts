import { z } from 'zod';
import { attachedLinkSchema } from './attached-link';
import { requiredFormattedText, requiredText } from './text';

/**
 * The Adherence Message as `set_adherence_message` stores it (ruling R66): a
 * plain heading of 1–120 characters, a Formatted Text body (R60: 2000
 * visible, 4000 stored) and an optional link, judged as an Attached Link (a
 * label of at most 60 characters and an http(s) address of at most 2048,
 * both or neither). The form publishes only with a heading and a body;
 * turning the message off is its own button.
 */
export const adherenceMessageSchema = z.object({
  title: requiredText({
    required: 'title_required',
    max: 120,
    tooLong: 'title_too_long',
  }),
  body: requiredFormattedText({
    required: 'body_required',
    tooLong: 'body_too_long',
  }),
  link: attachedLinkSchema,
});

/** Where each reason the command (or this schema) raises is shown. */
export const adherenceMessageFieldForReason: Readonly<Record<string, string>> =
  {
    title_required: 'title',
    title_too_long: 'title',
    body_required: 'body',
    body_too_long: 'body',
    link_label_required: 'link.label',
    link_label_too_long: 'link.label',
    link_url_required: 'link.url',
    link_url_invalid: 'link.url',
    link_url_too_long: 'link.url',
    // The server's pair rule cannot say which half is missing; the address
    // is the half most often left out (as for every Attached Link).
    link_incomplete: 'link.url',
  };
