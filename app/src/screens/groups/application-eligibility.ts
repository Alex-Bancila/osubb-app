import type { AdminGroup } from '../../queries/groups-admin';

export function acceptsApplication(group: AdminGroup, level: number) {
  return (
    group.status === 'active' &&
    // Ruling R25: a Private Group accepts no Applications; its members join
    // by Appointment. The server refuses too (group_private).
    !group.is_private &&
    !group.automatic_membership &&
    group.accepts_applications &&
    (group.application_level ?? group.min_level) <= level
  );
}
