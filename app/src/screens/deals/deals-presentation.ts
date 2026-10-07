import type { MemberIdentity } from '../../components/member/member-identity';
import { formatMemberCount } from '../../lib/format';
import {
  attachedLinksFrom,
  type AttachedLink,
} from '../../lib/schemas/attached-link';
import type { DealsTeam, RawDealRow } from '../../queries/deals';
import { formatAnnouncementDate } from '../announcements/announcements-presentation';

/** Where the OSUBB Deals tab lives, and its deep link (`?deal=<id>`). */
export const DEALS_PATH = '/anunturi/deals';
export const DEAL_PARAM = 'deal';
/** The team's page in Administrare (ruling R44). */
export const DEALS_ADMIN_PATH = '/administrare/deals';

export type DealPresentation = {
  id: number;
  title: string;
  body: string;
  /** The Organization Group: every Deal is posted from it. */
  groupId: number;
  /** The author as a Member Card button; null on a row without one. */
  authorMember: MemberIdentity | null;
  authorId: string | null;
  publishedAt: string;
  publishedLabel: string;
  deadline: string | null;
  links: AttachedLink[];
  /** The Deal Code, or null when the Deal has none. */
  code: string | null;
  isRead: boolean;
  /** The viewer opened the code before, on any device (`deal_code_reveals`). */
  isRevealed: boolean;
};

export function toDealPresentation(
  row: RawDealRow,
  members?: ReadonlyMap<string, MemberIdentity>,
): DealPresentation {
  const code = row.code?.trim() || null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    groupId: row.group_id,
    authorId: row.created_by,
    authorMember: row.created_by
      ? (members?.get(row.created_by) ?? {
          memberId: row.created_by,
          fullName: 'Membru OSUBB',
        })
      : null,
    publishedAt: row.published_at,
    publishedLabel: formatAnnouncementDate(row.published_at),
    deadline: row.deadline ?? null,
    links: attachedLinksFrom(row.links),
    code,
    isRead: (row.announcement_reads?.length ?? 0) > 0,
    isRevealed: (row.deal_code_reveals?.length ?? 0) > 0,
  };
}

/** A Deal is active until its Termen; one without a Termen stays active. */
export function isDealActive(
  deal: Pick<DealPresentation, 'deadline'>,
  now: Date = new Date(),
): boolean {
  if (deal.deadline === null) return true;
  const at = Date.parse(deal.deadline);
  return Number.isNaN(at) || at >= now.getTime();
}

/** Newest first: the order the tab and the team's list both use. */
export function sortDeals(items: DealPresentation[]): DealPresentation[] {
  return [...items].sort(
    (left, right) =>
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt),
  );
}

/** `Codul a fost deschis de 3 membri` (R45, the team's count). */
export function revealCountLabel(count: number): string {
  if (count === 0) return 'Codul nu a fost deschis încă';
  return `Codul a fost deschis de ${formatMemberCount(count)}`;
}

const MASK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * What the hidden stub shows under its blur: characters shaped like a code,
 * `length` of them (kept between 6 and 14; the stub asks for a full row of
 * 14, so the mask says nothing about the code's length), never the code itself
 * — the real one is not rendered, not even blurred, until the Member taps and
 * the reveal is recorded. Seeded by the Deal's id, so the mask does not
 * reshuffle on every render.
 */
export function dealCodeMask(seed: number, length: number): string {
  const size = Math.min(14, Math.max(6, length));
  let state = (seed * 2654435761) >>> 0 || 1;
  let mask = '';
  for (let index = 0; index < size; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    mask += MASK_ALPHABET[state % MASK_ALPHABET.length];
  }
  return mask;
}

export type DealsViewer = {
  memberId: string | undefined;
  /**
   * Holder, Coordonator or the Moderator (`my_capabilities().manage_deals_team`,
   * R44 amended): edits every Deal only together with `manageDeals`.
   */
  manageDealsTeam: boolean;
  /** On the team at all (`manage_deals`). */
  manageDeals: boolean;
  /** BC or the Moderator by live rank (`manage_roles`, level ≥ 6). */
  bcOrModerator: boolean;
};

/**
 * Editează (R44): the holder and the Coordonator on every Deal, the
 * Responsabil on their own. BC and the Moderator delete leftovers but do not
 * edit, unless they are on the team — the Moderator picks the team
 * (`manageDealsTeam`) without being on it. Presentation only: the policies
 * decide.
 */
export function mayEditDeal(
  deal: Pick<DealPresentation, 'authorId'>,
  viewer: DealsViewer,
): boolean {
  if (!viewer.manageDeals) return false;
  if (viewer.manageDealsTeam) return true;
  return viewer.memberId !== undefined && deal.authorId === viewer.memberId;
}

/** Șterge: whoever may edit it, and BC and the Moderator on any Deal. */
export function mayDeleteDeal(
  deal: Pick<DealPresentation, 'authorId'>,
  viewer: DealsViewer,
): boolean {
  return viewer.bcOrModerator || mayEditDeal(deal, viewer);
}

/** Whether the viewer sits on the team, so sees the reveal count. */
export function seesRevealCount(viewer: DealsViewer): boolean {
  return viewer.manageDeals || viewer.bcOrModerator;
}

/** The team's members, for the names a header lists. */
export function teamMemberIds(team: DealsTeam | undefined): string[] {
  if (!team) return [];
  return [team.holderId, team.coordinatorId, team.responsibleId].filter(
    (id): id is string => id !== null,
  );
}

/** The member fields the team pickers read (`useAppointableMembers`). */
type Candidate = { memberId: string; level: number; status: string };

function notOnTeam(team: DealsTeam | undefined, memberId: string): boolean {
  return (
    team?.holderId !== memberId &&
    team?.coordinatorId !== memberId &&
    team?.responsibleId !== memberId
  );
}

/**
 * The Coordonator picker's choices (R44): active BCE members (level 5), never
 * the holder or the Responsabil. The current Coordonator stays listed, so the
 * picker can show who it is.
 */
export function coordinatorCandidates<T extends Candidate>(
  members: readonly T[],
  team: DealsTeam | undefined,
): T[] {
  return members.filter(
    (member) =>
      member.status === 'activ' &&
      member.level === 5 &&
      (member.memberId === team?.coordinatorId ||
        notOnTeam(team, member.memberId)),
  );
}

/** The Responsabil picker's choices (R44): any active Member not on the team. */
export function responsibleCandidates<T extends Candidate>(
  members: readonly T[],
  team: DealsTeam | undefined,
): T[] {
  return members.filter(
    (member) =>
      member.status === 'activ' &&
      (member.memberId === team?.responsibleId ||
        notOnTeam(team, member.memberId)),
  );
}
