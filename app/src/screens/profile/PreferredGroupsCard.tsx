import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Star } from 'lucide-react';
import { Panel } from '../../components/layout';
import { PREFERRED_GROUPS_ANCHOR } from '../../components/preferred-groups/preferred-groups';
import { ErrorState, Loading } from '../../components/states';
import { Button } from '../../components/ui/button';
import {
  initialDraft,
  preferenceTree,
  selectedSummary,
  summaryText,
} from '../../lib/preferred-groups';
import { useGroupPreferences } from '../../queries/group-preferences';
import { useGroups } from '../../queries/reference';
import { PreferredGroupsSheet } from './PreferredGroupsSheet';

/** How many unselected Groups the card names before it says "+N". */
const NAMED = 4;

/**
 * **Grupuri preferate** (ruling R43), under the notification settings in
 * Profil: how many Groups are selected, which ones are not, and the button
 * that opens the tree. Only a BCE, BC or Moderator has one — the server
 * answers nobody else — so for everyone else the card is not drawn at all.
 */
export function PreferredGroupsCard() {
  const preferences = useGroupPreferences();
  const groups = useGroups();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();
  const rows = preferences.data;
  const available = Boolean(rows?.length);

  // Arriving from a page's "Doar grupurile preferate" chip: bring it into view.
  useEffect(() => {
    if (available && hash === `#${PREFERRED_GROUPS_ANCHOR}`)
      sectionRef.current?.scrollIntoView?.({ block: 'center' });
  }, [hash, available]);

  const nodes = useMemo(
    () =>
      rows && groups.data
        ? preferenceTree([...groups.data.values()], rows)
        : [],
    [rows, groups.data],
  );
  const initial = useMemo(() => initialDraft(rows ?? []), [rows]);

  if (preferences.isPending || preferences.isError || !available) {
    // Below level 5 the list is empty: no card. A failed read says nothing
    // here either -- the preference only narrows, so nothing is lost.
    return null;
  }

  const summary = selectedSummary(nodes, initial);
  const off = nodes.filter((node) => !node.lock && initial.has(node.group.id));

  return (
    <Panel eyebrow="Setări" icon={Star} title="Grupuri preferate">
      <div
        ref={sectionRef}
        id={PREFERRED_GROUPS_ANCHOR}
        data-testid="preferred-groups-card"
        className="grid gap-3"
      >
        {groups.isPending ? (
          <Loading label="Se încarcă grupurile…" />
        ) : groups.isError ? (
          <ErrorState
            error={groups.error}
            text="Nu am putut încărca grupurile."
            onRetry={() => void groups.refetch()}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <p className="m-0 font-medium tabular-nums">
                  {summaryText(summary)}
                </p>
                <p className="m-0 text-sm text-muted-foreground">
                  {off.length
                    ? 'Grupurile debifate nu îți trimit notificări.'
                    : 'Primești notificări din toate grupurile.'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSaved(false);
                  setOpen(true);
                }}
              >
                Alege grupurile
              </Button>
            </div>
            {off.length > 0 && (
              <ul
                aria-label="Grupuri debifate"
                className="m-0 flex flex-wrap gap-1.5 p-0"
              >
                {off.slice(0, NAMED).map((node) => (
                  <li
                    key={node.group.id}
                    className="max-w-48 truncate rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground"
                  >
                    {node.group.name}
                  </li>
                ))}
                {off.length > NAMED && (
                  <li className="px-1 py-0.5 text-xs text-muted-foreground">
                    +{off.length - NAMED}
                  </li>
                )}
              </ul>
            )}
            <p
              role="status"
              className="m-0 text-sm text-emerald-700 empty:hidden dark:text-emerald-400"
            >
              {saved && 'Grupurile preferate au fost salvate.'}
            </p>
          </>
        )}
      </div>
      <PreferredGroupsSheet
        open={open}
        nodes={nodes}
        initial={initial}
        onClose={() => setOpen(false)}
        onSaved={() => setSaved(true)}
      />
    </Panel>
  );
}
