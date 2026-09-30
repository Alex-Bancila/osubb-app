/**
 * "Something about this Member's standing just changed" (#959).
 *
 * Every command that changes a Member's role, level or Group standing writes
 * them a `system` Notification in the same transaction (`set_member_role`
 * "Rol actualizat", the Group roster commands, the application decisions).
 * The Realtime channel raises this signal when such a row lands; the
 * `AuthProvider` answers it by refreshing the session, so the Organization
 * Claims stamped into the access token follow the database within seconds
 * instead of at the next focus (#598) or the hourly expiry.
 *
 * A window event rather than a shared module state: the provider and the
 * channel live in different layers, and each test gets a clean slate.
 */
const MEMBERSHIP_CHANGED = 'osubb:membership-changed';

export function signalMembershipChange(): void {
  window.dispatchEvent(new Event(MEMBERSHIP_CHANGED));
}

/** Returns the unsubscribe. */
export function onMembershipChange(listener: () => void): () => void {
  window.addEventListener(MEMBERSHIP_CHANGED, listener);
  return () => window.removeEventListener(MEMBERSHIP_CHANGED, listener);
}
