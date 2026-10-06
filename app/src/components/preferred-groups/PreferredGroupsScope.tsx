import { useMemo, useState, type ReactNode } from 'react';
import { usePreferredGroupsData } from '../../queries/group-preferences';
import { ScopeContext } from './preferred-groups';

/**
 * One visit of a page that opens on the preferred Groups (ruling R43):
 * Taskuri, Calendar, Anunțuri and Clasament. **Arată tot** lasts for the
 * visit — leaving the page and coming back opens it filtered again — so the
 * state lives here, in the page, and is never stored.
 */
export function PreferredGroupsScope({ children }: { children: ReactNode }) {
  const [showAll, setShowAll] = useState(false);
  const { muted, memberId } = usePreferredGroupsData();
  const value = useMemo(
    () => ({ showAll, setShowAll, muted, memberId }),
    [showAll, muted, memberId],
  );
  return (
    <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
  );
}
