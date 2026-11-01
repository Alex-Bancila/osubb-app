import { countLabel } from '../../components/delete-for-good/delete-text';
import type { GroupArchivePreview } from '../../queries/groups-admin';

/**
 * What Dezarhivează cannot undo (#1149, ruling R65): the cancelled Events and
 * the declined Applications stay as archiving left them.
 */
export const NO_UNARCHIVE = 'Dezarhivarea nu le readuce.';

/**
 * The archive preview's non-zero counts as sentences, in the order a member
 * weighs them: the structure, then the Notifications archiving sends (#1149).
 */
export function groupArchiveItems(preview: GroupArchivePreview): string[] {
  const items: string[] = [];
  if (preview.subgroups > 0)
    items.push(
      countLabel(preview.subgroups, 'subgrup arhivat', 'subgrupuri arhivate'),
    );
  if (preview.events > 0)
    items.push(
      `${countLabel(preview.events, 'eveniment viitor anulat', 'evenimente viitoare anulate')}, cu notificare către participanți`,
    );
  if (preview.applications > 0)
    items.push(
      `${countLabel(preview.applications, 'cerere de înscriere respinsă', 'cereri de înscriere respinse')}, cu notificare către ${preview.applications === 1 ? 'solicitant' : 'solicitanți'}`,
    );
  return items;
}
