import { countLabel } from '../../components/delete-for-good/delete-text';
import { formatMemberCount, formatPointCount } from '../../lib/format';
import type { GroupDeletePreview } from '../../queries/delete-for-good';

/** Where a deleted Group's page sends the member, with the receipt. */
export const GROUPS_LIST_PATH = '/administrare/grupuri';
export type GroupsListState = { receipt?: string };

/**
 * The preview's non-zero counts as sentences, in the order a member weighs
 * them: structure, work and points, then everything else (#1017).
 */
export function groupDeleteItems(preview: GroupDeletePreview): string[] {
  const items: string[] = [];
  if (preview.subgroups > 0)
    items.push(countLabel(preview.subgroups, 'subgrup', 'subgrupuri'));
  if (preview.tasks > 0)
    items.push(
      countLabel(preview.tasks, 'task', 'taskuri') +
        (preview.tasksWithPoints > 0
          ? `, dintre care ${preview.tasksWithPoints} cu puncte`
          : ''),
    );
  if (preview.points !== 0)
    items.push(
      `${formatPointCount(preview.points)} retrase de la ${countLabel(preview.pointMembers, 'membru', 'membri')}, care primesc o notificare`,
    );
  if (preview.events > 0)
    items.push(countLabel(preview.events, 'eveniment', 'evenimente'));
  if (preview.announcements > 0)
    items.push(countLabel(preview.announcements, 'anunț', 'anunțuri'));
  if (preview.campaigns > 0)
    items.push(countLabel(preview.campaigns, 'campanie', 'campanii'));
  if (preview.applications > 0)
    items.push(
      countLabel(
        preview.applications,
        'cerere de înscriere',
        'cereri de înscriere',
      ),
    );
  if (preview.requests > 0)
    items.push(
      countLabel(
        preview.requests,
        'cerere de activitate realizată',
        'cereri de activitate realizată',
      ),
    );
  if (preview.members > 0)
    items.push(
      `${formatMemberCount(preview.members)} din roster (conturile lor rămân)`,
    );
  return items;
}
