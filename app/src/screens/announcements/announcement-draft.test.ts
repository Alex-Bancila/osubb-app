import { describe, expect, it } from 'vitest';
import {
  announcementChanges,
  draftFromAnnouncement,
  type AnnouncementDraft,
} from './announcement-draft';

const stored = {
  title: 'Recrutare toamnă',
  body: 'Detalii în formular.',
  // 2 October 2026, 23:59 in Romania (UTC+3).
  deadline: '2026-10-02T20:59:00.000Z',
  minLevel: 2,
  priority: 'important' as const,
  links: [
    { label: 'Formular', url: 'https://forms.gle/x' },
    { label: 'Program', url: 'https://osubb.ro/program' },
  ],
};

function parsed(draft: AnnouncementDraft, deadline: string | null = null) {
  return {
    title: draft.title.trim(),
    body: draft.body.trim(),
    deadline,
    links: draft.links
      .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
      .filter((link) => link.label && link.url),
  };
}

describe('draftFromAnnouncement (#930)', () => {
  it('prefills every field, the Termen as Romania wall-clock time', () => {
    expect(draftFromAnnouncement(stored)).toEqual({
      title: 'Recrutare toamnă',
      body: 'Detalii în formular.',
      deadline: '2026-10-02T23:59',
      minLevel: 2,
      priority: 'important',
      links: [
        { label: 'Formular', url: 'https://forms.gle/x' },
        { label: 'Program', url: 'https://osubb.ro/program' },
      ],
    });
  });
});

describe('announcementChanges (#930)', () => {
  const initial = draftFromAnnouncement(stored);

  it('sends nothing when nothing changed', () => {
    expect(announcementChanges(initial, initial, parsed(initial))).toEqual({});
  });

  it('sends only the changed title and priority', () => {
    const draft = {
      ...initial,
      title: 'Recrutare iarnă',
      priority: 'critical' as const,
    };
    expect(announcementChanges(initial, draft, parsed(draft))).toEqual({
      title: 'Recrutare iarnă',
      priority: 'critical',
    });
  });

  it('never sends an untouched Termen, even one that has passed', () => {
    const draft = { ...initial, minLevel: 0 };
    expect(announcementChanges(initial, draft, parsed(draft))).toEqual({
      min_level: 0,
    });
  });

  it('sends a moved or cleared Termen', () => {
    const moved = { ...initial, deadline: '2026-10-03T12:00' };
    expect(
      announcementChanges(
        initial,
        moved,
        parsed(moved, '2026-10-03T09:00:00.000Z'),
      ),
    ).toEqual({ deadline: '2026-10-03T09:00:00.000Z' });
    const cleared = { ...initial, deadline: '' };
    expect(announcementChanges(initial, cleared, parsed(cleared))).toEqual({
      deadline: null,
    });
  });

  it('sends the whole list of Attached Links when any row changes (R46)', () => {
    const [first, second] = initial.links as [
      { label: string; url: string },
      { label: string; url: string },
    ];
    const draft = {
      ...initial,
      links: [{ ...first, url: 'https://forms.gle/y' }, second],
    };
    expect(announcementChanges(initial, draft, parsed(draft))).toEqual({
      links: [
        { label: 'Formular', url: 'https://forms.gle/y' },
        { label: 'Program', url: 'https://osubb.ro/program' },
      ],
    });
    const reordered = { ...initial, links: [second, first] };
    expect(
      announcementChanges(initial, reordered, parsed(reordered)).links,
    ).toEqual([second, first]);
    const removed = { ...initial, links: [] };
    expect(announcementChanges(initial, removed, parsed(removed))).toEqual({
      links: [],
    });
    // A blank row left open is not a change.
    const blank = {
      ...initial,
      links: [first, second, { label: '', url: '' }],
    };
    expect(announcementChanges(initial, blank, parsed(blank))).toEqual({});
  });
});
