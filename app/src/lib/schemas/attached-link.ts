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
  // The server's pair rule (#684) cannot say which half is missing; the
  // address is the half a member most often leaves out.
  link_incomplete: 'url',
};

/** At most five Attached Links on an Announcement or a Task (ruling R46). */
export const MAX_ATTACHED_LINKS = 5;

/** One Attached Link as stored in a `links` array: both halves present. */
export type AttachedLink = { label: string; url: string };

/**
 * A list of Attached Links (ruling R46), as `links` jsonb stores it on an
 * Announcement or a Task: each row is the pair rule above, a fully blank row
 * is dropped, and there are at most five. A row's issue lands under that row
 * (`links.3.url`); a server refusal cannot name the row, so
 * `linksFieldForReason` sends it to the list as a whole.
 */
export const attachedLinksSchema = z
  .array(attachedLinkSchema)
  .max(MAX_ATTACHED_LINKS, { error: 'too_many_links' })
  .transform((links): AttachedLink[] =>
    links.flatMap((link) =>
      link.label !== null && link.url !== null
        ? [{ label: link.label, url: link.url }]
        : [],
    ),
  );

/**
 * Where a list's reasons land when the server sends them: on the list as a
 * whole (`name`, the caller's field, `links`), since a server reason does
 * not say which row it is about. The browser's own issues carry their row in
 * the path (`links.3.url`) and land under that row.
 */
export function linksFieldForReason(
  name: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...Object.keys(fieldForReason), 'too_many_links'].map((reason) => [
      reason,
      name,
    ]),
  );
}

/**
 * The Attached Links a row carries, read defensively from its `links` jsonb:
 * every entry with a non-blank label and address, trimmed, in order, at most
 * five. Whether the address is safe to open is `AttachedLinkButton`'s check.
 * The migration that added `links` backfilled it from the old pair on every
 * row, so nothing here falls back to `link_label`/`link_url` or
 * `form_label`/`form_url`.
 */
export function attachedLinksFrom(value: unknown): AttachedLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry: unknown) => {
      if (entry === null || typeof entry !== 'object') return [];
      const { label, url } = entry as Record<string, unknown>;
      const text = typeof label === 'string' ? label.trim() : '';
      const address = typeof url === 'string' ? url.trim() : '';
      return text && address ? [{ label: text, url: address }] : [];
    })
    .slice(0, MAX_ATTACHED_LINKS);
}

/**
 * Whether two lists hold the same links, as a save would store them: rows
 * compared trimmed, in order, a fully blank row ignored. An edit form uses it
 * to tell "nothing changed" from a reordered, added or removed link.
 */
export function sameAttachedLinks(
  a: readonly { label: string; url: string }[],
  b: readonly { label: string; url: string }[],
): boolean {
  const kept = (links: readonly { label: string; url: string }[]) =>
    links
      .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
      .filter((link) => link.label || link.url);
  const left = kept(a);
  const right = kept(b);
  return (
    left.length === right.length &&
    left.every(
      (link, index) =>
        link.label === right[index]?.label && link.url === right[index]?.url,
    )
  );
}
