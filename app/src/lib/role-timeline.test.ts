import { describe, expect, it } from 'vitest';
import {
  buildRoleSegments,
  formatRoleDuration,
  formatSegmentPeriod,
  type RoleHistoryInput,
} from './role-timeline';

function change(
  from_role: string,
  to_role: string,
  created_at: string,
  changed_by: string | null = 'bc-1',
): RoleHistoryInput {
  return {
    from_role,
    to_role,
    created_at,
    actor_kind: changed_by ? 'human' : 'automatic',
    changed_by,
  };
}

describe('buildRoleSegments', () => {
  it('no rows → one open segment from joined_at in the current Role', () => {
    const segments = buildRoleSegments('2025-10-01', 'voluntar', []);

    expect(segments).toEqual([
      {
        role: 'voluntar',
        startDate: new Date(2025, 9, 1),
        endDate: null,
        openedBy: null,
      },
    ]);
  });

  it('one row → two segments split at the change', () => {
    const segments = buildRoleSegments('2025-10-01', 'voluntar', [
      change('recrut', 'voluntar', '2026-02-01T10:00:00Z'),
    ]);

    expect(segments).toEqual([
      {
        role: 'recrut',
        startDate: new Date(2025, 9, 1),
        endDate: new Date(2026, 1, 1),
        openedBy: null,
      },
      {
        role: 'voluntar',
        startDate: new Date(2026, 1, 1),
        endDate: null,
        openedBy: { kind: 'human', memberId: 'bc-1' },
      },
    ]);
  });

  it('two rows → three segments with correct boundaries and actors', () => {
    const segments = buildRoleSegments('2025-10-01', 'activ', [
      change('recrut', 'voluntar', '2026-02-01T10:00:00Z'),
      change('voluntar', 'activ', '2026-06-01T10:00:00Z', null),
    ]);

    expect(segments.map((s) => s.role)).toEqual([
      'recrut',
      'voluntar',
      'activ',
    ]);
    expect(segments[0]?.startDate).toEqual(new Date(2025, 9, 1));
    expect(segments[0]?.endDate).toEqual(new Date(2026, 1, 1));
    expect(segments[1]?.startDate).toEqual(new Date(2026, 1, 1));
    expect(segments[1]?.endDate).toEqual(new Date(2026, 5, 1));
    expect(segments[2]?.startDate).toEqual(new Date(2026, 5, 1));
    expect(segments[2]?.endDate).toBeNull();
    expect(segments[2]?.openedBy).toEqual({
      kind: 'automatic',
      memberId: null,
    });
    expect(
      segments.map((s) => formatRoleDuration(s.startDate, s.endDate)),
    ).toEqual(['4 luni', '4 luni', null]);
  });

  it('reads created_at as its calendar day in Bucharest', () => {
    // 22:30 UTC on 31 January is 00:30 on 1 February in Romania.
    const segments = buildRoleSegments('2025-10-01', 'voluntar', [
      change('recrut', 'voluntar', '2026-01-31T22:30:00Z'),
    ]);

    expect(segments[0]?.endDate).toEqual(new Date(2026, 1, 1));
    expect(segments[1]?.startDate).toEqual(new Date(2026, 1, 1));
    expect(
      formatRoleDuration(
        segments[0]?.startDate ?? null,
        segments[0]?.endDate ?? null,
      ),
    ).toBe('4 luni');
  });

  it('orders rows by created_at whatever order they arrive in', () => {
    const segments = buildRoleSegments('2025-10-01', 'activ', [
      change('voluntar', 'activ', '2026-06-01T10:00:00Z'),
      change('recrut', 'voluntar', '2026-02-01T10:00:00Z'),
    ]);

    expect(segments.map((s) => s.role)).toEqual([
      'recrut',
      'voluntar',
      'activ',
    ]);
  });

  it('ignores Status rows (same Role on both sides)', () => {
    const segments = buildRoleSegments('2025-10-01', 'voluntar', [
      change('voluntar', 'voluntar', '2026-03-01T10:00:00Z'),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.role).toBe('voluntar');
  });

  it('the open segment holds the current Role', () => {
    const segments = buildRoleSegments('2025-10-01', 'activ', [
      change('recrut', 'responsabil', '2026-02-01T10:00:00Z'),
    ]);

    expect(segments[1]?.role).toBe('activ');
  });

  it('null joined_at and no rows → current Role only, no dates', () => {
    expect(buildRoleSegments(null, 'voluntar', [])).toEqual([
      { role: 'voluntar', startDate: null, endDate: null, openedBy: null },
    ]);
  });

  it('null joined_at with rows → still the current Role only, no dates', () => {
    const segments = buildRoleSegments(null, 'activ', [
      change('recrut', 'voluntar', '2026-02-01T10:00:00Z'),
      change('voluntar', 'activ', '2026-06-01T10:00:00Z'),
    ]);

    expect(segments).toEqual([
      { role: 'activ', startDate: null, endDate: null, openedBy: null },
    ]);
  });

  it('a row dated before joined_at is clamped to it', () => {
    const joined = new Date(2026, 0, 1);
    const segments = buildRoleSegments('2026-01-01', 'activ', [
      change('recrut', 'voluntar', '2025-12-01T10:00:00Z'),
      change('voluntar', 'activ', '2026-03-01T10:00:00Z'),
    ]);

    expect(segments[0]?.startDate).toEqual(joined);
    expect(segments[0]?.endDate).toEqual(joined);
    expect(segments[1]?.startDate).toEqual(joined);
    expect(segments[1]?.endDate).toEqual(new Date(2026, 2, 1));
    for (const s of segments) {
      if (s.startDate && s.endDate) {
        expect(s.endDate.getTime()).toBeGreaterThanOrEqual(
          s.startDate.getTime(),
        );
      }
    }
  });
});

describe('formatRoleDuration', () => {
  it('returns null when either date is missing', () => {
    expect(formatRoleDuration(null, new Date())).toBeNull();
    expect(formatRoleDuration(new Date(), null)).toBeNull();
  });

  it.each([
    [new Date(2026, 0, 1), new Date(2026, 0, 15), 'sub o lună'],
    [new Date(2026, 0, 1), new Date(2026, 1, 1), '1 lună'],
    [new Date(2025, 9, 1), new Date(2026, 1, 1), '4 luni'],
    [new Date(2025, 0, 1), new Date(2026, 0, 1), '1 an'],
    [new Date(2025, 0, 1), new Date(2026, 2, 1), '1 an și 2 luni'],
    [new Date(2024, 0, 1), new Date(2026, 1, 1), '2 ani și 1 lună'],
    [new Date(2024, 0, 1), new Date(2026, 0, 1), '2 ani'],
    [new Date(2026, 0, 31), new Date(2026, 1, 28), 'sub o lună'],
  ])('%s → %s is "%s"', (start, end, expected) => {
    expect(formatRoleDuration(start, end)).toBe(expected);
  });
});

describe('formatSegmentPeriod', () => {
  it('a closed segment shows its start and end dates', () => {
    expect(
      formatSegmentPeriod({
        role: 'recrut',
        startDate: new Date(2025, 9, 1),
        endDate: new Date(2026, 1, 12),
        openedBy: null,
      }),
    ).toBe('1 oct. 2025 – 12 feb. 2026');
  });

  it('the current segment is "din <dată>"', () => {
    expect(
      formatSegmentPeriod({
        role: 'voluntar',
        startDate: new Date(2026, 1, 12),
        endDate: null,
        openedBy: null,
      }),
    ).toBe('din 12 feb. 2026');
  });

  it('an undated segment has no period', () => {
    expect(
      formatSegmentPeriod({
        role: 'voluntar',
        startDate: null,
        endDate: null,
        openedBy: null,
      }),
    ).toBeNull();
  });
});
