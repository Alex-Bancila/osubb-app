import { useEffect, useState } from 'react';
import { Page, PageGrid, PageHeader } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { useCapabilities } from '../../lib/capabilities';
import { firstName, formatLongDate } from '../../lib/format';
import { useMyProfile } from '../../queries/profile';
import AwaitingReviewCard from './AwaitingReviewCard';
import MyPointsCard from './MyPointsCard';
import NextEventCard from './NextEventCard';
import NextTaskCard from './NextTaskCard';

/** "sâmbătă, 27 septembrie 2026" → "Sâmbătă, 27 septembrie 2026". */
function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/*
 * Headers and boxes on shared rows. Once panels sit side by side, each spans
 * two grid rows — its header, then its box — through a subgrid, so a header
 * that wraps its link or carries a description never pushes its box below
 * the boxes next to it: the boxes in a row start and end together, and every
 * header keeps to the top of its row.
 */
const twoColumnPanel =
  'md:row-span-2 md:grid md:grid-rows-subgrid md:gap-y-0 md:*:first:self-start';
const threeColumnPanel =
  'xl:row-span-2 xl:grid xl:grid-rows-subgrid xl:gap-y-0 xl:*:first:self-start';
function twoColumnRows(rows: 1 | 2) {
  return rows === 1
    ? 'md:grid-rows-[auto_1fr]'
    : 'md:grid-rows-[auto_1fr_auto_1fr]';
}

/**
 * Acasă (#822, ruling R27): one row of equal boxes that answers "what next".
 *
 * The page decides which panels exist before it renders the grid, from the
 * server's capability row (`my_capabilities()`):
 * - below BCE (`seeLeadership` false): **Punctajul meu**, **Următorul task**
 *   and **Următorul eveniment** in three columns — plus **De evaluat** in a
 *   2 × 2 for a Group Responsible or Coordonator (`manageTasks`, plan D2);
 * - BC / BCE: **De evaluat** (or **Următorul task** without `manageTasks`)
 *   and **Următorul eveniment**. They do not work by points, so no score.
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
      />
      {capabilities.isPending ? (
        <Loading />
      ) : capabilities.isError ? (
        <ErrorState
          error={capabilities.error}
          onRetry={() => void capabilities.refetch()}
        />
      ) : leader ? (
        <PageGrid columns={2} className={twoColumnRows(1)}>
          {reviewer ? (
            <AwaitingReviewCard now={now} className={twoColumnPanel} />
          ) : (
            <NextTaskCard now={now} className={twoColumnPanel} />
          )}
          <NextEventCard now={now} className={twoColumnPanel} />
        </PageGrid>
      ) : reviewer ? (
        <PageGrid columns={2} className={twoColumnRows(2)}>
          <MyPointsCard className={twoColumnPanel} />
          <AwaitingReviewCard now={now} className={twoColumnPanel} />
          <NextTaskCard now={now} className={twoColumnPanel} />
          <NextEventCard now={now} className={twoColumnPanel} />
        </PageGrid>
      ) : (
        <PageGrid columns={3} className="xl:grid-rows-[auto_1fr]">
          <MyPointsCard className={threeColumnPanel} />
          <NextTaskCard now={now} className={threeColumnPanel} />
          <NextEventCard now={now} className={threeColumnPanel} />
        </PageGrid>
      )}
    </Page>
  );
}
