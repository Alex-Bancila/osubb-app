import type { Group } from '../../../queries/reference';
import { edu } from './edu';
import { fin } from './fin';
import { hr } from './hr';
import { imgPr } from './img-pr';
import { interne } from './interne';
import { proiecte } from './proiecte';
import { tin } from './tin';
import type { GuideSheet } from './types';

export * from './types';
export { ratingGuide, ratingHint, difficultyHint } from './general';

/** Every Group list of the guide, Departments keyed by their `short`. */
export const departmentSheets: Readonly<Record<string, GuideSheet>> = {
  EDU: edu,
  FIN: fin,
  HR: hr,
  'IMG&PR': imgPr,
  TIN: tin,
};
export const guideSheets: readonly GuideSheet[] = [
  ...Object.values(departmentSheets),
  interne,
  proiecte,
];

export type GuideGroup = Pick<
  Group,
  'id' | 'name' | 'short' | 'category' | 'path' | 'is_organization'
>;

export type GroupGuide = {
  /** The Task's Group, when known. */
  group: GuideGroup | null;
  /** The list that applies, or null: the guide shows its general part only. */
  sheet: GuideSheet | null;
  /** The ancestor whose list applies, when it is not the Group itself. */
  via: GuideGroup | null;
};

/**
 * Which list of the guide a Task's Group shows (#986), read from its path
 * (root-first, ending in the Group's own id):
 *
 * - any Group in the Project category, or under one → Proiecte;
 * - the OSUBB root Group (the Organization) → Interne;
 * - otherwise the top-level Group below the Organization: a Department with a
 *   list (EDU, FIN, HR, IMG&PR, TIN, by `short`) → its list, for a Child Group
 *   too; any other Group (Diverse, Secretariat, a free-standing Team) → none.
 */
export function guideForGroup(
  groupId: number | null | undefined,
  groups: ReadonlyMap<number, GuideGroup> | undefined,
): GroupGuide {
  const group = groupId == null ? undefined : groups?.get(groupId);
  if (!group || !groups)
    return { group: group ?? null, sheet: null, via: null };
  const chain = (group.path.length ? group.path : [group.id])
    .map((id) => groups.get(id))
    .filter((row): row is GuideGroup => row !== undefined);
  const viaOf = (row: GuideGroup) => (row.id === group.id ? null : row);

  const project = chain.find((row) => row.category === 'project');
  if (project) return { group, sheet: proiecte, via: viaOf(project) };

  const top = chain.find((row) => !row.is_organization);
  if (!top) return { group, sheet: interne, via: null };
  const sheet = departmentSheets[(top.short ?? '').trim().toUpperCase()];
  return sheet
    ? { group, sheet, via: viaOf(top) }
    : { group, sheet: null, via: null };
}
