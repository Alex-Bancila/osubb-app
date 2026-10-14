import { Hand } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Page, PageHeader } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { useCapabilities } from '../../lib/capabilities';
import { firstName, formatLongDate } from '../../lib/format';
import { useMyProfile } from '../../queries/profile';
import CountTiles from './CountTiles';
import PointsStat from './PointsStat';
import PushPromptCard from './PushPromptCard';
import UpNext from './UpNext';

/** "sâmbătă, 27 septembrie 2026" → "Sâmbătă, 27 septembrie 2026". */
function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Acasă (#822, ruling R27; #859): what is waiting, then what comes next.
 *
 * Under the date and the greeting, a row of count tiles that open what is
 * waiting (`CountTiles`), then one list, **Urmează** (`UpNext`): the next
 * deadlines, Events and the Task to evaluate, as compact rows that link to
 * where the full card lives. The page decides what applies to the viewer
 * before it renders either, from the server's capability row
 * (`my_capabilities()`):
 * - below BCE (`seeLeadership` false): the points and Role as a stat on the
 *   greeting line (`PointsStat`, no panel — Alex, 2026-09-28), their own
 *   Tasks in the tiles and the list; a Group Responsible or Coordonator
 *   (`manageTasks`, plan D2) also has **De evaluat** and **Cereri de decis**;
 * - BC / BCE with `manageTasks`: **De evaluat** and **Cereri de decis** in
 *   place of their own Tasks, which are never read. They do not work by
 *   points, so no stat. Leadership without `manageTasks` keeps its own Tasks.
 *
 * Above them, for every Role, **Pornește notificările** (2026-10-06) while
 * this device could receive Web Push and nobody has answered the permission
 * yet; it renders nothing otherwise (`PushPromptCard`).
 *
 * The Clasament and the Cupa Departamentelor live on Clasament, not here.
 * Each tile and each source of the list owns its query and its states, so a
 * slow or failed read never blanks what is next to it.
 */
export default function DashboardScreen() {
  const profile = useMyProfile();
  const nickname = profile.data?.nickname?.trim();
  const name = nickname || firstName(profile.data?.full_name);
  const capabilities = useCapabilities();
  // One clock for the page, so "overdue" and "has it started" follow the
  // wall while it stays open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const leader = capabilities.data?.seeLeadership === true;
  const reviewer = capabilities.data?.manageTasks === true;
  // BC and BCE who manage Tasks evaluate them; everyone else executes them.
  const ownTasks = !(leader && reviewer);

  return (
    <Page>
      {/* No skeleton for the name: the greeting reads fine without it for
          the moment it takes, and "Salut, ▮▮▮▮" reads like a bug. */}
      <PageHeader
        eyebrow={capitalised(formatLongDate(now))}
        title={
          <span className="inline-flex max-w-full min-w-0 items-center gap-2.5">
            <span className="min-w-0">Salut{name ? `, ${name}` : ''}</span>
            <Hand
              aria-hidden="true"
              className="size-[0.85em] shrink-0 -rotate-12 text-primary"
            />
          </span>
        }
        actions={capabilities.data && !leader ? <PointsStat /> : undefined}
      />
      <PushPromptCard />
      {capabilities.isPending ? (
        <Loading />
      ) : capabilities.isError ? (
        <ErrorState
          error={capabilities.error}
          onRetry={() => void capabilities.refetch()}
        />
      ) : (
        <>
          <CountTiles ownTasks={ownTasks} reviewer={reviewer} />
          <UpNext now={now} ownTasks={ownTasks} reviewer={reviewer} />
        </>
      )}
    </Page>
  );
}
