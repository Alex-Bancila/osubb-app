import type { AdminGroup } from '../../queries/groups-admin';

export function acceptsApplication(group: AdminGroup, level: number) {
  return (
    group.status === 'active' &&
    !group.automatic_membership &&
    group.accepts_applications &&
    (group.application_level ?? group.min_level) <= level
  );
}
