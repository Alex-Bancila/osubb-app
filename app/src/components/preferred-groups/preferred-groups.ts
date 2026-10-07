import { createContext, useContext, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { chosenGroupId, parseWorkFilter } from '../../lib/work-filter';

/** Profil's card, where the chip's words lead (`/profil#grupuri-preferate`). */
export const PREFERRED_GROUPS_ANCHOR = 'grupuri-preferate';

export type Scope = {
  showAll: boolean;
  setShowAll: (next: boolean) => void;
  /** The Groups the member muted (empty below level 5, or while unknown). */
  muted: ReadonlySet<number>;
  /** The member, whose own work a view never leaves out. */
  memberId: string | undefined;
};

export const ScopeContext = createContext<Scope | null>(null);

export type PreferredGroupsView = {
  /** The member unselected at least one Group, on a page that follows it. */
  available: boolean;
  /** The page shows only the preferred Groups now. */
  active: boolean;
  /** The member, whose own work stays whatever its Group. */
  memberId: string | undefined;
  /** Whether an item of this Group is shown (always true when not `active`). */
  keepGroup: (groupId: number) => boolean;
  showAll: () => void;
  showPreferred: () => void;
};

/**
 * The page's preferred-Groups filter. It applies only to a BCE, BC or
 * Moderator who unselected a Group, inside a `PreferredGroupsScope`, and
 * steps aside while the Work Filter names a Group — an explicit choice wins.
 */
export function usePreferredGroups(): PreferredGroupsView {
  const scope = useContext(ScopeContext);
  const [params] = useSearchParams();
  const explicit =
    chosenGroupId(parseWorkFilter(new URLSearchParams(params))) !== undefined;
  const muted = scope?.muted;
  const available = scope !== null && (muted?.size ?? 0) > 0 && !explicit;
  const active = available && !scope.showAll;
  const setShowAll = scope?.setShowAll;
  const memberId = scope?.memberId;
  return useMemo(
    () => ({
      available,
      active,
      memberId,
      keepGroup: (groupId: number) => !active || !muted?.has(groupId),
      showAll: () => setShowAll?.(true),
      showPreferred: () => setShowAll?.(false),
    }),
    [available, active, muted, setShowAll, memberId],
  );
}
