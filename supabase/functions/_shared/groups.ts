// #602: resolving a spreadsheet's Department and Team names to Groups.
//
// The CSV header stays exactly `name,email,dept,team` — BC's spreadsheets are
// written by hand, months apart, by people who have never seen a Group id — so
// the resolver is what absorbs the change from legacy ids to Groups. A value
// names a Group by its SHORT name or its DISPLAY name, compared with case and
// diacritics folded away, which is why `Educational`, `educațional` and `EDU`
// all reach the same Group.
//
// Diacritics are stripped through NFD plus a combining-mark sweep rather than a
// hand-written letter table: Romanian is written with both the correct comma-
// below forms (ș U+0219, ț U+021B) and the cedilla forms every older Windows
// keyboard produced (ş U+015F, ţ U+0163), and a table would have to list both.

export interface GroupReference {
  id: number;
  name: string;
  short: string | null;
  /** Root-first ancestor chain ending in this Group's own id (groups.path). */
  path: number[];
}

export interface GroupLookup {
  /** Every active Group a spreadsheet value could mean, by short or display name. */
  resolve(value: string): number[];
  /** True when `groupId` is `ancestorId` itself or lies anywhere below it. */
  isBelow(groupId: number, ancestorId: number): boolean;
  /** True when this id is one of the active Groups the lookup was built from. */
  has(groupId: number): boolean;
}

/** Case-folded, diacritic-free, whitespace-collapsed form of a name. */
export function normalizeGroupKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildGroupLookup(
  groups: readonly GroupReference[],
): GroupLookup {
  // One pass per request, not per row: an import of 100 rows must not walk the
  // Group tree 200 times.
  const byKey = new Map<string, number[]>();
  const paths = new Map<number, readonly number[]>();

  const remember = (value: string | null, id: number) => {
    if (!value) return;
    const key = normalizeGroupKey(value);
    if (!key) return;
    const ids = byKey.get(key);
    if (ids === undefined) byKey.set(key, [id]);
    else if (!ids.includes(id)) ids.push(id);
  };

  for (const group of groups) {
    paths.set(group.id, group.path ?? [group.id]);
    remember(group.name, group.id);
    remember(group.short, group.id);
  }

  return {
    resolve: (value) => byKey.get(normalizeGroupKey(value)) ?? [],
    isBelow: (groupId, ancestorId) =>
      (paths.get(groupId) ?? []).includes(ancestorId),
    has: (groupId) => paths.has(groupId),
  };
}
