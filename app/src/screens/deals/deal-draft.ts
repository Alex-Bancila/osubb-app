import { isoToBucharestWallTime } from '../../lib/calendar-time';
import type { DealInput } from '../../queries/deals';
import type { AttachedLinkValue } from '../../components/attached-link/AttachedLinkFields';
import { sameAttachedLinks } from '../../lib/schemas/attached-link';
import type { DealPresentation } from './deals-presentation';

/** What the Deal form holds as its inputs hold it; the Termen in Romania's time. */
export type DealDraft = {
  title: string;
  body: string;
  deadline: string;
  links: AttachedLinkValue[];
  code: string;
};

export const EMPTY_DEAL_DRAFT: DealDraft = {
  title: '',
  body: '',
  deadline: '',
  links: [],
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
    links: deal.links.map((link) => ({ ...link })),
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
  if (!sameAttachedLinks(parsed.links, initial.links))
    changes.links = parsed.links;
  if (parsed.code !== (initial.code.trim() || null)) changes.code = parsed.code;
  return changes;
}
