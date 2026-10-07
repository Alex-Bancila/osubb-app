import { describe, expect, it } from 'vitest';
import type { RawDealRow } from '../../queries/deals';
import {
  coordinatorCandidates,
  dealCodeMask,
  dealLinks,
  isDealActive,
  mayDeleteDeal,
  mayEditDeal,
  responsibleCandidates,
  revealCountLabel,
  seesRevealCount,
  toDealPresentation,
  type DealsViewer,
} from './deals-presentation';

const ME = 'me';
const OTHER = 'other';

function row(overrides: Partial<RawDealRow> = {}): RawDealRow {
  return {
    id: 7,
    title: 'Reducere 20% la Librăria X',
    body: 'Pentru membrii OSUBB.',
    group_id: 1,
    published_at: '2026-10-07T10:00:00Z',
    deadline: null,
    created_by: OTHER,
    kind: 'deal',
    code: 'OSUBB20',
    links: [{ label: 'Magazin', url: 'https://example.ro' }],
    announcement_reads: [],
    deal_code_reveals: [],
    ...overrides,
  };
}

const viewer = (overrides: Partial<DealsViewer> = {}): DealsViewer => ({
  memberId: ME,
  manageDeals: false,
  manageDealsTeam: false,
  bcOrModerator: false,
  ...overrides,
});

describe('toDealPresentation', () => {
  it('reads my own read and reveal from the embedded rows', () => {
    const unread = toDealPresentation(row());
    expect(unread.isRead).toBe(false);
    expect(unread.isRevealed).toBe(false);
    const done = toDealPresentation(
      row({
        announcement_reads: [{ read_at: 'x' }],
        deal_code_reveals: [{ revealed_at: 'x' }],
      }),
    );
    expect(done.isRead).toBe(true);
    expect(done.isRevealed).toBe(true);
  });

  it('treats a blank code as no code, so no stub', () => {
    expect(toDealPresentation(row({ code: '   ' })).code).toBeNull();
    expect(toDealPresentation(row({ code: null })).code).toBeNull();
  });
});

describe('dealLinks (R46)', () => {
  it('keeps every { label, url } pair in order and skips anything else', () => {
    expect(
      dealLinks([
        { label: 'A', url: 'https://a.ro' },
        'junk',
        { label: 'B' },
        { label: 'C', url: 'https://c.ro' },
      ]),
    ).toEqual([
      { label: 'A', url: 'https://a.ro' },
      { label: 'C', url: 'https://c.ro' },
    ]);
    expect(dealLinks(null)).toEqual([]);
  });
});

describe('isDealActive', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  it('is active without a Termen and until its Termen, expired after', () => {
    expect(isDealActive({ deadline: null }, now)).toBe(true);
    expect(isDealActive({ deadline: '2026-10-07T12:00:00Z' }, now)).toBe(true);
    expect(isDealActive({ deadline: '2026-10-07T11:59:59Z' }, now)).toBe(false);
  });
});

describe('dealCodeMask', () => {
  it('is code-shaped, as long as the code within 6–14, stable, and never the code', () => {
    const mask = dealCodeMask(7, 'OSUBB20'.length);
    expect(mask).toHaveLength(7);
    expect(mask).toMatch(/^[A-Z2-9]+$/);
    expect(mask).not.toBe('OSUBB20');
    expect(dealCodeMask(7, 7)).toBe(mask);
    expect(dealCodeMask(7, 2)).toHaveLength(6);
    expect(dealCodeMask(7, 80)).toHaveLength(14);
  });
});

describe('who may edit and delete a Deal (R44)', () => {
  const mine = { authorId: ME };
  const theirs = { authorId: OTHER };

  it('lets the holder and the Coordonator edit and delete every Deal', () => {
    const team = viewer({ manageDeals: true, manageDealsTeam: true });
    expect(mayEditDeal(theirs, team)).toBe(true);
    expect(mayDeleteDeal(theirs, team)).toBe(true);
  });

  it('lets the Responsabil edit and delete their own Deals only', () => {
    const responsabil = viewer({ manageDeals: true });
    expect(mayEditDeal(mine, responsabil)).toBe(true);
    expect(mayDeleteDeal(mine, responsabil)).toBe(true);
    expect(mayEditDeal(theirs, responsabil)).toBe(false);
    expect(mayDeleteDeal(theirs, responsabil)).toBe(false);
  });

  it('lets BC and the Moderator delete any Deal but not edit it', () => {
    const bc = viewer({ bcOrModerator: true });
    expect(mayDeleteDeal(theirs, bc)).toBe(true);
    expect(mayEditDeal(theirs, bc)).toBe(false);
  });

  it('gives a member nothing, even on a Deal they wrote before leaving the team', () => {
    expect(mayEditDeal(mine, viewer())).toBe(false);
    expect(mayDeleteDeal(mine, viewer())).toBe(false);
  });

  it('shows the reveal count to the team, BC and the Moderator only', () => {
    expect(seesRevealCount(viewer({ manageDeals: true }))).toBe(true);
    expect(seesRevealCount(viewer({ bcOrModerator: true }))).toBe(true);
    expect(seesRevealCount(viewer())).toBe(false);
  });
});

describe('the team pickers (R44)', () => {
  const members = [
    { memberId: 'holder', level: 6, status: 'activ' },
    { memberId: 'bce', level: 5, status: 'activ' },
    { memberId: 'bce-old', level: 5, status: 'inactiv' },
    { memberId: 'bce-2', level: 5, status: 'activ' },
    { memberId: 'volunteer', level: 2, status: 'activ' },
  ];
  const team = {
    holderId: 'holder',
    coordinatorId: 'bce-2',
    responsibleId: 'volunteer',
  };

  it('offers active BCE members for Coordonator, never the holder or the Responsabil', () => {
    expect(coordinatorCandidates(members, team).map((m) => m.memberId)).toEqual(
      ['bce', 'bce-2'],
    );
  });

  it('offers any active member for Responsabil except the holder and the Coordonator', () => {
    expect(responsibleCandidates(members, team).map((m) => m.memberId)).toEqual(
      ['bce', 'volunteer'],
    );
  });
});

it('words the reveal count in Romanian', () => {
  expect(revealCountLabel(0)).toBe('Codul nu a fost deschis încă');
  expect(revealCountLabel(1)).toBe('Codul a fost deschis de 1 membru');
  expect(revealCountLabel(12)).toBe('Codul a fost deschis de 12 membri');
  expect(revealCountLabel(20)).toBe('Codul a fost deschis de 20 de membri');
});
