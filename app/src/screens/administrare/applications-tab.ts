import { useMemo } from 'react';
import type { Capabilities } from '../../lib/capabilities';
import { useManagedGroupApplications } from '../../queries/group-applications';
import {
  useAdminGroups,
  useMyGroupRoles,
  type AdminGroup,
} from '../../queries/groups-admin';
import type { MyGroup } from '../../queries/my-groups';

/**
 * Whether the Cereri de aderare tab can hold anything for this viewer
 * (relevance B55): a Group they manage takes Applications, or an Application
 * is still waiting on one of their Groups (filed before Applications were
 * turned off). A Group they manage is any Group for BC and the Moderator, and
 * otherwise a Group where they hold a Group Role, here or inherited.
 */
export function applicationsTabShown({
  createTopLevelGroups,
  groups,
  myGroups,
  pending,
}: {
  createTopLevelGroups: boolean;
  groups: readonly Pick<AdminGroup, 'id' | 'accepts_applications' | 'status'>[];
  myGroups: readonly Pick<MyGroup, 'id' | 'group_role'>[];
  pending: number;
}): boolean {
  if (pending > 0) return true;
  const managed = new Set(
    myGroups
      .filter((group) => group.group_role !== 'member')
      .map((group) => group.id),
  );
  return groups.some(
    (group) =>
      group.accepts_applications &&
      group.status === 'active' &&
      (createTopLevelGroups || managed.has(group.id)),
  );
}

/**
 * `applicationsTabShown` over the live reads; `undefined` until they answer,
 * so the tab bar never shows the tab and then takes it away.
 */
export function useApplicationsTabShown(
  capabilities: Capabilities | undefined,
): boolean | undefined {
  const groups = useAdminGroups();
  const myGroups = useMyGroupRoles();
  const applications = useManagedGroupApplications();
  return useMemo(() => {
    // A failed read hides nothing: the tab says what it could not load.
    if (groups.isError || myGroups.isError || applications.isError) return true;
    if (!capabilities || !groups.data || !myGroups.data || !applications.data)
      return undefined;
    return applicationsTabShown({
      createTopLevelGroups: capabilities.createTopLevelGroups,
      groups: groups.data,
      myGroups: myGroups.data,
      pending: applications.data.length,
    });
  }, [
    capabilities,
    groups.data,
    groups.isError,
    myGroups.data,
    myGroups.isError,
    applications.data,
    applications.isError,
  ]);
}
