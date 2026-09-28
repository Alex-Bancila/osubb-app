import { buildRoleSegments } from '../../lib/role-timeline';
import type { MyProfile } from '../../queries/profile';
import { useMyRoleHistory } from '../../queries/role-history';

/**
 * Whether Profil draws **Parcursul organizațional** (#859 B39): only from the
 * second Role row. One row repeats the Identitate chip and "Membru din …",
 * so the page decides before it renders its grid. While the history loads
 * the panel waits (it appears once there is a second row); a failed read
 * keeps the panel, so its retry stays reachable. Shares the timeline's query.
 */
export function useRoleTimelineShown(profile: MyProfile | null | undefined) {
  const historyQuery = useMyRoleHistory();
  if (!profile) return false;
  if (historyQuery.isError) return true;
  if (!historyQuery.data) return false;
  return (
    buildRoleSegments(profile.joined_at, profile.role, historyQuery.data)
      .length > 1
  );
}
