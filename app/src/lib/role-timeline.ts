/**
 * Pure functions that turn `role_history` rows, `joined_at`, and the current
 * Role into a displayable timeline. No React, no Supabase — testable alone.
 *
 * The issue spec (#633) defines the segment model:
 *  - First segment starts at `joined_at` with the earliest row's `from_role`
 *    (or the current Role when there are no rows).
 *  - Each row opens a new segment whose Role is the row's `to_role`.
 *  - The last segment is open-ended (endDate = null).
 *  - A null `joined_at` degrades: current Role only, no dates, no durations.
 */

import type { Database } from './database.types';

type MemberRole = Database['public']['Enums']['member_role'];

export type RoleSegment = {
  /** The member_role enum value for this segment. */
  role: MemberRole;
  /** Calendar start. Null only when joined_at is null and this is the sole segment. */
  startDate: Date | null;
  /** Calendar end. Null for the current (last) segment. */
  endDate: Date | null;
};

export type RoleHistoryInput = {
  from_role: MemberRole;
  to_role: MemberRole;
  created_at: string; // ISO-8601 timestamptz
};

/**
 * Build an ordered array of role segments from the raw data.
 *
 * @param joinedAt  The `profiles.joined_at` date string (YYYY-MM-DD) or null.
 * @param currentRole  The member's current `profiles.role`.
 * @param rows  Role-change rows ordered by `created_at` ascending.
 */
export function buildRoleSegments(
  joinedAt: string | null,
  currentRole: MemberRole,
  rows: RoleHistoryInput[],
): RoleSegment[] {
  const joinDate = joinedAt ? parseDate(joinedAt) : null;

  // No history rows → single open segment
  if (rows.length === 0) {
    return [{ role: currentRole, startDate: joinDate, endDate: null }];
  }

  const segments: RoleSegment[] = [];

  // First segment: role is the earliest row's from_role, starts at joined_at
  const firstRow = rows[0]; if (!firstRow) return [];
  const firstRowDate = new Date(firstRow.created_at);
  const firstStart =
    joinDate && joinDate < firstRowDate ? joinDate : joinDate ?? firstRowDate;

  segments.push({
    role: firstRow.from_role,
    startDate: firstStart,
    endDate: firstRowDate,
  });

  // Middle segments: each row starts a new segment
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; if (!row) continue;
    const rowDate = new Date(row.created_at);
    const nextRow = rows[i + 1];
    const nextDate = nextRow ? new Date(nextRow.created_at) : null;

    segments.push({
      role: row.to_role,
      startDate: rowDate,
      endDate: nextDate, // null for the last segment
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Duration formatting — Romanian
// ---------------------------------------------------------------------------

/**
 * Compute the duration between two dates in whole months and years,
 * then format in Romanian.
 *
 * Returns null when either date is missing (null joined_at case).
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
  if (years > 0) parts.push(formatYears(years));
  if (months > 0) parts.push(formatMonths(months));

  return parts.join(' și ');
}

/**
 * Format a segment for display.
 *
 * - Closed segment: "Recrut timp de 4 luni"
 * - Current segment with date: "Voluntar din 12 feb. 2026"
 * - Current segment without date: just the role name
 */
export function formatSegmentLabel(
  roleName: string,
  segment: RoleSegment,
  fallbackYear: number | null = null,
): string {
  if (segment.endDate !== null) {
    // Closed segment
    const dur = formatRoleDuration(segment.startDate, segment.endDate);
    return dur ? `${roleName} timp de ${dur}` : roleName;
  }

  // Current (open) segment
  if (segment.startDate) {
    return `${roleName} din ${formatShortDate(segment.startDate)}`;
  }

  if (fallbackYear) {
    return `${roleName} din ${fallbackYear}`;
  }

  return roleName;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Floor month difference between two dates. */
function monthDiff(a: Date, b: Date): number {
  const years = b.getFullYear() - a.getFullYear();
  const months = b.getMonth() - a.getMonth();
  const days = b.getDate() - a.getDate();
  let total = years * 12 + months;
  if (days < 0) total -= 1;
  return Math.max(0, total);
}

function formatYears(n: number): string {
  if (n === 1) return '1 an';
  return `${n} ani`;
}

function formatMonths(n: number): string {
  if (n === 1) return '1 lună';
  return `${n} luni`;
}

/** "12 feb. 2026" style short date in Romanian. */
function formatShortDate(d: Date): string {
  return new Intl.DateTimeFormat('ro-RO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/** Parse a YYYY-MM-DD date string into a local Date. */
function parseDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  date.setFullYear(Number(y));
  return date;
}
