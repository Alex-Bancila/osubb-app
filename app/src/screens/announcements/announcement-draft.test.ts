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
  formLabel: 'Formular',
  formUrl: 'https://forms.gle/x',
};

function parsed(draft: AnnouncementDraft, deadline: string | null = null) {
  return {
    title: draft.title.trim(),
    body: draft.body.trim(),
    deadline,
    link: { label: draft.linkLabel || null, url: draft.linkUrl || null },
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
      linkLabel: 'Formular',
      linkUrl: 'https://forms.gle/x',
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

  it('sends both halves of the Attached Link when either changes', () => {
    const draft = { ...initial, linkUrl: 'https://forms.gle/y' };
    expect(announcementChanges(initial, draft, parsed(draft))).toEqual({
      form_label: 'Formular',
      form_url: 'https://forms.gle/y',
    });
    const removed = { ...initial, linkLabel: '', linkUrl: '' };
    expect(announcementChanges(initial, removed, parsed(removed))).toEqual({
      form_label: null,
      form_url: null,
    });
  });
});
