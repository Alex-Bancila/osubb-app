import { describe, expect, it } from 'vitest';
import {
  buildRoleSegments,
  formatRoleDuration,
  formatSegmentLabel,
  type RoleHistoryInput,
  type RoleSegment,
} from './role-timeline';

// ---------------------------------------------------------------------------
// buildRoleSegments
// ---------------------------------------------------------------------------

describe('buildRoleSegments', () => {
  it('no rows → one open segment from joined_at in the current Role', () => {
    const segments = buildRoleSegments('2025-10-01', 'voluntar', []);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.role).toBe('voluntar');
    expect(segments[0]!.startDate).toEqual(new Date(2025, 9, 1));
    expect(segments[0]!.endDate).toBeNull();
  });

  it('one row → two segments with correct boundaries', () => {
    const rows: RoleHistoryInput[] = [
      {
        from_role: 'recrut',
        to_role: 'voluntar',
        created_at: '2026-02-01T10:00:00Z',
      },
    ];

    const segments = buildRoleSegments('2025-10-01', 'voluntar', rows);

    expect(segments).toHaveLength(2);

    // First segment: Recrut from joined_at to the row date
    expect(segments[0]!.role).toBe('recrut');
    expect(segments[0]!.startDate).toEqual(new Date(2025, 9, 1));
    expect(segments[0]!.endDate).toEqual(new Date('2026-02-01T10:00:00Z'));

    // Second segment: Voluntar from the row date, open
    expect(segments[1]!.role).toBe('voluntar');
    expect(segments[1]!.startDate).toEqual(new Date('2026-02-01T10:00:00Z'));
    expect(segments[1]!.endDate).toBeNull();
  });

  it('two rows → three segments with correct boundaries and durations', () => {
    const rows: RoleHistoryInput[] = [
      {
        from_role: 'recrut',
        to_role: 'voluntar',
        created_at: '2026-02-01T10:00:00Z',
      },
      {
        from_role: 'voluntar',
        to_role: 'activ',
        created_at: '2026-06-01T10:00:00Z',
      },
    ];

    const segments = buildRoleSegments('2025-10-01', 'activ', rows);

    expect(segments).toHaveLength(3);

    expect(segments[0]!.role).toBe('recrut');
    expect(segments[0]!.startDate).toEqual(new Date(2025, 9, 1));
    expect(segments[0]!.endDate).toEqual(new Date('2026-02-01T10:00:00Z'));

    expect(segments[1]!.role).toBe('voluntar');
    expect(segments[1]!.startDate).toEqual(new Date('2026-02-01T10:00:00Z'));
    expect(segments[1]!.endDate).toEqual(new Date('2026-06-01T10:00:00Z'));

    expect(segments[2]!.role).toBe('activ');
    expect(segments[2]!.startDate).toEqual(new Date('2026-06-01T10:00:00Z'));
    expect(segments[2]!.endDate).toBeNull();
  });

  it('null joined_at and no rows → current Role only, no dates', () => {
    const segments = buildRoleSegments(null, 'voluntar', []);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.role).toBe('voluntar');
    expect(segments[0]!.startDate).toBeNull();
    expect(segments[0]!.endDate).toBeNull();
  });

  it('null joined_at with rows → first segment starts at first row date', () => {
    const rows: RoleHistoryInput[] = [
      {
        from_role: 'recrut',
        to_role: 'voluntar',
        created_at: '2026-02-01T10:00:00Z',
      },
    ];

    const segments = buildRoleSegments(null, 'voluntar', rows);

    expect(segments).toHaveLength(2);
    // Without joined_at, the first segment starts at the first row date
    expect(segments[0]!.role).toBe('recrut');
    expect(segments[0]!.startDate).toEqual(new Date('2026-02-01T10:00:00Z'));
    expect(segments[0]!.endDate).toEqual(new Date('2026-02-01T10:00:00Z'));

    expect(segments[1]!.role).toBe('voluntar');
    expect(segments[1]!.startDate).toEqual(new Date('2026-02-01T10:00:00Z'));
    expect(segments[1]!.endDate).toBeNull();
  });

  it('row dated before joined_at → first segment clamped to joined_at', () => {
    const rows: RoleHistoryInput[] = [
      {
        from_role: 'recrut',
        to_role: 'voluntar',
        created_at: '2025-12-01T10:00:00Z',
      },
    ];

    const segments = buildRoleSegments('2026-01-01', 'voluntar', rows);

    expect(segments).toHaveLength(2);
    // First segment starts at joined_at (clamped), not the row date
    expect(segments[0]!.startDate).toEqual(new Date(2026, 0, 1));
    expect(segments[0]!.endDate).toEqual(new Date('2025-12-01T10:00:00Z'));
  });
});

// ---------------------------------------------------------------------------
// formatRoleDuration
// ---------------------------------------------------------------------------

describe('formatRoleDuration', () => {
  it('returns null when start is null', () => {
    expect(formatRoleDuration(null, new Date())).toBeNull();
  });

  it('returns null when end is null', () => {
    expect(formatRoleDuration(new Date(), null)).toBeNull();
  });

  it('formats "sub o lună" for less than a month', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, 15);
    expect(formatRoleDuration(start, end)).toBe('sub o lună');
  });

  it('formats "1 lună" for exactly one month', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 1, 1);
    expect(formatRoleDuration(start, end)).toBe('1 lună');
  });

  it('formats "4 luni" for four months', () => {
    const start = new Date(2025, 9, 1);
    const end = new Date(2026, 1, 1);
    expect(formatRoleDuration(start, end)).toBe('4 luni');
  });

  it('formats "1 an" for exactly one year', () => {
    const start = new Date(2025, 0, 1);
    const end = new Date(2026, 0, 1);
    expect(formatRoleDuration(start, end)).toBe('1 an');
  });

  it('formats "1 an și 2 luni" for fourteen months', () => {
    const start = new Date(2025, 0, 1);
    const end = new Date(2026, 2, 1);
    expect(formatRoleDuration(start, end)).toBe('1 an și 2 luni');
  });

  it('formats "2 ani și 1 lună" for twenty-five months', () => {
    const start = new Date(2024, 0, 1);
    const end = new Date(2026, 1, 1);
    expect(formatRoleDuration(start, end)).toBe('2 ani și 1 lună');
  });

  it('formats "2 ani" for exactly two years', () => {
    const start = new Date(2024, 0, 1);
    const end = new Date(2026, 0, 1);
    expect(formatRoleDuration(start, end)).toBe('2 ani');
  });
});

// ---------------------------------------------------------------------------
// formatSegmentLabel
// ---------------------------------------------------------------------------

describe('formatSegmentLabel', () => {
  it('closed segment with duration → "Recrut timp de 4 luni"', () => {
    const segment: RoleSegment = {
      role: 'recrut',
      startDate: new Date(2025, 9, 1),
      endDate: new Date(2026, 1, 1),
    };
    expect(formatSegmentLabel('Recrut', segment)).toBe(
      'Recrut timp de 4 luni',
    );
  });

  it('current segment with date → "Voluntar din <date>"', () => {
    const segment: RoleSegment = {
      role: 'voluntar',
      startDate: new Date(2026, 1, 12),
      endDate: null,
    };
    const label = formatSegmentLabel('Voluntar', segment);
    // The exact format depends on Intl, but should contain "din" and a date
    expect(label).toMatch(/^Voluntar din /);
    expect(label).toMatch(/12/);
    expect(label).toMatch(/2026/);
  });

  it('current segment without date → role name only', () => {
    const segment: RoleSegment = {
      role: 'voluntar',
      startDate: null,
      endDate: null,
    };
    expect(formatSegmentLabel('Voluntar', segment)).toBe('Voluntar');
  });

  it('closed segment with no calculable duration → role name only', () => {
    const segment: RoleSegment = {
      role: 'recrut',
      startDate: null,
      endDate: new Date(2026, 1, 1),
    };
    expect(formatSegmentLabel('Recrut', segment)).toBe('Recrut');
  });
});
