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

/**
 * The Group's application form link (#698, ruling R18), when it has a usable
 * one: then **Aplică** opens the form instead of filing an in-app
 * Application. An address that is not http(s) — a row written outside the
 * server's guard — counts as no link, so the in-app flow stays offered rather
 * than a button that `AttachedLinkButton` would refuse to render.
 */
export function applicationForm(
  group: AdminGroup,
): { label: string; url: string } | null {
  const label = group.application_form_label;
  const url = group.application_form_url;
  return label && url && /^https?:\/\//.test(url) ? { label, url } : null;
}
