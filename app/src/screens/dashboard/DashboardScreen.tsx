import { useEffect, useState } from 'react';
import { Page, PageGrid, PageHeader } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { useCapabilities } from '../../lib/capabilities';
import { firstName, formatLongDate } from '../../lib/format';
import { useMyProfile } from '../../queries/profile';
import AwaitingReviewCard from './AwaitingReviewCard';
import NextEventCard from './NextEventCard';
import NextTaskCard from './NextTaskCard';
import PointsStat from './PointsStat';

/** "sâmbătă, 27 septembrie 2026" → "Sâmbătă, 27 septembrie 2026". */
function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/*
 * Headers and boxes on shared rows. Once panels sit side by side, each spans
 * two grid rows — its header, then its box — through a subgrid, so a header
 * that wraps its link or carries a description never pushes its box below
 * the boxes next to it. Two cards are like items, so the row has
 * `equalHeights` (#876) and their boxes start and end together. Headers
 * keep to the bottom of their row, so the titles share one line whether or
 * not a panel carries an eyebrow (Următorul eveniment keeps 'Calendar'; the
 * Task panels drop theirs, B7).
 */
const twoColumnPanel =
  'md:row-span-2 md:grid md:grid-rows-subgrid md:gap-y-0 md:*:first:self-end ' +
  // A box holding only an empty state keeps its own height beside a card:
  // equal heights are for two cards, never for a mostly empty box (Alex,
  // 2026-09-28). The tops still line up.
  'md:[&:has([data-slot=empty-state])>[data-slot=panel-box]]:self-start';
/** One row: each panel spans its header row and its box row. */
const panelRow = 'md:grid-rows-[auto_1fr]';

/**
 * Acasă (#822, ruling R27; #859): equal boxes that answer "what next".
 *
 * The page decides which panels exist before it renders the grid, from the
 * server's capability row (`my_capabilities()`):
 * - below BCE (`seeLeadership` false): the points and Role as a stat on the
 *   greeting line (`PointsStat`, no panel — Alex, 2026-09-28), then
 *   **Următorul task** and **Următorul eveniment** in two columns from `md`;
 *   a Group Responsible or Coordonator (`manageTasks`, plan D2) has
 *   **De evaluat** in its own row above them;
 * - BC / BCE: **De evaluat** (or **Următorul task** without `manageTasks`)
 *   and **Următorul eveniment**. They do not work by points, so no stat.
 *
 * The Clasament and the Cupa Departamentelor live on Clasament, not here.
 * Each panel owns its query and its loading, empty and error states, so a
 * slow or failed read never blanks the panel next to it.
 */
export default function DashboardScreen() {
  const profile = useMyProfile();
  const nickname = profile.data?.nickname?.trim();
  const name = nickname || firstName(profile.data?.full_name);
  const capabilities = useCapabilities();
  // One clock for every panel, so "overdue" and "has it started" follow the
  // wall while the page stays open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const leader = capabilities.data?.seeLeadership === true;
  const reviewer = capabilities.data?.manageTasks === true;

  return (
    <Page>
      {/* No skeleton for the name: the greeting reads fine without it for
          the moment it takes, and "Salut, ▮▮▮▮" reads like a bug. */}
      <PageHeader
        eyebrow={capitalised(formatLongDate(now))}
        title={`Salut${name ? `, ${name}` : ''} 👋`}
        actions={capabilities.data && !leader ? <PointsStat /> : undefined}
      />
      {capabilities.isPending ? (
        <Loading />
      ) : capabilities.isError ? (
        <ErrorState
          error={capabilities.error}
          onRetry={() => void capabilities.refetch()}
        />
      ) : leader ? (
        <PageGrid columns={2} equalHeights className={panelRow}>
          {reviewer ? (
            <AwaitingReviewCard now={now} className={twoColumnPanel} />
          ) : (
            <NextTaskCard now={now} className={twoColumnPanel} />
          )}
          <NextEventCard now={now} className={twoColumnPanel} />
        </PageGrid>
      ) : reviewer ? (
        <>
          {/* Its own row, as tall as what it holds: the row below shares one
              height between two cards, which this one should not dictate. */}
          <AwaitingReviewCard now={now} />
          <PageGrid columns={2} equalHeights className={panelRow}>
            <NextTaskCard now={now} className={twoColumnPanel} />
            <NextEventCard now={now} className={twoColumnPanel} />
          </PageGrid>
        </>
      ) : (
        <PageGrid columns={2} equalHeights className={panelRow}>
          <NextTaskCard now={now} className={twoColumnPanel} />
          <NextEventCard now={now} className={twoColumnPanel} />
        </PageGrid>
      )}
    </Page>
  );
}
