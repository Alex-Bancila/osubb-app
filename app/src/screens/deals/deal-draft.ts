import { isoToBucharestWallTime } from '../../lib/calendar-time';
import type { DealInput } from '../../queries/deals';
import type { DealLinkDraft } from './DealLinks';
import type { DealPresentation } from './deals-presentation';

/** What the Deal form holds as its inputs hold it; the Termen in Romania's time. */
export type DealDraft = {
  title: string;
  body: string;
  deadline: string;
  links: DealLinkDraft[];
  code: string;
};

export const EMPTY_DEAL_DRAFT: DealDraft = {
  title: '',
  body: '',
  deadline: '',
  links: [{ label: '', url: '' }],
  code: '',
};

export function draftFromDeal(
  deal: Pick<
    DealPresentation,
    'title' | 'body' | 'deadline' | 'links' | 'code'
  >,
): DealDraft {
  return {
    title: deal.title,
    body: deal.body,
    deadline: deal.deadline ? isoToBucharestWallTime(deal.deadline) : '',
    links:
      deal.links.length > 0
        ? deal.links.map((link) => ({ ...link }))
        : [{ label: '', url: '' }],
    code: deal.code ?? '',
  };
}

type Parsed = {
  title: string;
  body: string;
  deadline: string | null;
  links: { label: string; url: string }[];
  code: string | null;
};

/** Only the fields that changed: an untouched, since-passed Termen is never sent. */
export function dealChanges(
  initial: DealDraft,
  draft: DealDraft,
  parsed: Parsed,
): Partial<DealInput> {
  const changes: Partial<DealInput> = {};
  if (parsed.title !== initial.title.trim()) changes.title = parsed.title;
  if (parsed.body !== initial.body.trim()) changes.body = parsed.body;
  if (draft.deadline !== initial.deadline) changes.deadline = parsed.deadline;
  // The stored links, as the schema would have kept them.
  const initialLinks = initial.links.flatMap((link) => {
    const label = link.label.trim();
    const url = link.url.trim();
    return label && url ? [{ label, url }] : [];
  });
  if (JSON.stringify(parsed.links) !== JSON.stringify(initialLinks))
    changes.links = parsed.links;
  if (parsed.code !== (initial.code.trim() || null)) changes.code = parsed.code;
  return changes;
}
