/**
 * Pure functions that turn `role_history` rows, `joined_at`, and the current
 * Role into a displayable timeline (#633, ruling R8). No React, no Supabase.
 *
 * The segment model:
 *  - The first segment starts at `joined_at` in the earliest change's
 *    `from_role` (or the current Role when there is no change).
 *  - Each change opens a new segment; the last one is open and holds the
 *    current Role (`profiles.role` is the truth for "now").
 *  - A change dated before `joined_at` is clamped to it, so no segment ends
 *    before it starts.
 *  - A null `joined_at` degrades to the current Role only: no dates, no
 *    durations — the caller shows "Membru din <joined_year>" instead.
 *
 * Role values are plain strings: `role_history.from_role`/`to_role` are the
 * `member_role` enum today and become text when #593 retires level four, and
 * both shapes render the same way.
 */

import { parseLocalDate } from './format';

/** One `role_history` row as the timeline reads it. */
export type RoleHistoryInput = {
  from_role: string;
  to_role: string;
  created_at: string; // ISO-8601 timestamptz
  /** `human` (a BC or Moderator decided, named by `changed_by`) or `automatic`. */
  actor_kind: string;
  changed_by: string | null;
};

/** Who made the change that opened a segment. */
export type RoleChangeActor = {
  kind: string;
  memberId: string | null;
};

export type RoleSegment = {
  /** The Role key (`recrut`, `voluntar`, …) held during this segment. */
  role: string;
  /** Null only when `joined_at` is null (the sole, undated segment). */
  startDate: Date | null;
  /** Null for the current (last) segment. */
  endDate: Date | null;
  /** The change that opened this segment; null for the first one. */
  openedBy: RoleChangeActor | null;
};

/**
 * Build the segments, oldest first.
 *
 * @param joinedAt  `profiles.joined_at` (YYYY-MM-DD) or null.
 * @param currentRole  The Member's current `profiles.role`.
 * @param rows  The Member's `role_history` rows, in any order. Status rows
 *   (same Role on both sides, #580) are ignored.
 */
export function buildRoleSegments(
  joinedAt: string | null,
  currentRole: string,
  rows: readonly RoleHistoryInput[],
): RoleSegment[] {
  const joinDate = parseLocalDate(joinedAt);
  const changes = rows
    .filter((row) => row.from_role !== row.to_role)
    .map((row) => ({ row, at: new Date(row.created_at) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const first = changes[0];
  if (!joinDate || !first) {
    return [
      { role: currentRole, startDate: joinDate, endDate: null, openedBy: null },
    ];
  }

  const clamp = (date: Date) => (date < joinDate ? joinDate : date);

  const segments: RoleSegment[] = [
    {
      role: first.row.from_role,
      startDate: joinDate,
      endDate: clamp(first.at),
      openedBy: null,
    },
  ];

  changes.forEach(({ row, at }, i) => {
    const next = changes[i + 1];
    segments.push({
      role: next ? row.to_role : currentRole,
      startDate: clamp(at),
      endDate: next ? clamp(next.at) : null,
      openedBy: { kind: row.actor_kind, memberId: row.changed_by },
    });
  });

  return segments;
}

/**
 * Whole months and years between two dates, in Romanian: "4 luni",
 * "1 an și 2 luni", "sub o lună". Null when either date is missing.
 */
export function formatRoleDuration(
  start: Date | null,
  end: Date | null,
): string | null {
  if (!start || !end) return null;

  const totalMonths = monthDiff(start, end);
  if (totalMonths < 1) return 'sub o lună';

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  const parts: string[] = [];
  if (years > 0) parts.push(years === 1 ? '1 an' : `${years} ani`);
  if (months > 0) parts.push(months === 1 ? '1 lună' : `${months} luni`);

  return parts.join(' și ');
}

/**
 * The dates line of a segment: "1 oct. 2025 – 1 feb. 2026" for a closed one,
 * "din 1 feb. 2026" for the current one, null when the segment is undated.
 */
export function formatSegmentPeriod(segment: RoleSegment): string | null {
  if (!segment.startDate) return null;
  if (!segment.endDate) return `din ${formatShortDate(segment.startDate)}`;
  return `${formatShortDate(segment.startDate)} – ${formatShortDate(segment.endDate)}`;
}

/** Floor month difference between two dates. */
function monthDiff(a: Date, b: Date): number {
  const years = b.getFullYear() - a.getFullYear();
  const months = b.getMonth() - a.getMonth();
  const days = b.getDate() - a.getDate();
  let total = years * 12 + months;
  if (days < 0) total -= 1;
  return Math.max(0, total);
}

/** "12 feb. 2026" — short Romanian date. */
function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat('ro-RO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}
