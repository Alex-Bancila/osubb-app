import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { cn } from 'cn';
import {
  BackLink,
  FabActions,
  focusRingClass,
  Page,
  PageHeader,
  PageTabs,
  panelBoxClass,
} from '../../components/layout';
import { useCapabilities } from '../../lib/capabilities';
import { useEnterMotion } from '../../lib/motion';
import { useMinWidth } from '../volunteers/use-min-width';
import {
  ADMINISTRARE_PATH,
  APPLICATIONS_TAB_PATH,
  allowedTabs,
  type AdministrareTab,
} from './administrare-tabs';
import {
  applicationCount,
  useApplicationsTabShown,
  usePendingApplicationCount,
} from './applications-tab';

const NAV_LABEL = 'Secțiunile administrării';

/**
 * The sections as a phone's menu: two columns of tiles, each a link with its
 * icon and name. Cereri de aderare carries how many wait — a number the
 * layout already reads to decide whether the section shows at all.
 */
function SectionMenu({
  tabs,
  pendingApplications,
}: {
  tabs: readonly AdministrareTab[];
  pendingApplications: number;
}) {
  return (
    <nav aria-label={NAV_LABEL} data-slot="administrare-menu">
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const pending =
            tab.path === APPLICATIONS_TAB_PATH ? pendingApplications : 0;
          return (
            <li key={tab.path} className="flex min-w-0">
              <Link
                to={tab.path}
                className={cn(
                  panelBoxClass,
                  'pressable relative flex min-h-24 flex-1 flex-col items-start justify-between gap-3 text-foreground no-underline',
                  focusRingClass,
                )}
              >
                <Icon
                  aria-hidden="true"
                  className="size-5 shrink-0 text-(--red-600)"
                />
                <span className="max-w-full text-sm leading-snug font-semibold wrap-break-word hyphens-auto">
                  {tab.label}
                </span>
                {pending > 0 && (
                  <>
                    <span
                      aria-hidden="true"
                      data-slot="section-count"
                      className="absolute top-3 right-3 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs leading-none font-bold text-primary-foreground tabular-nums"
                    >
                      {pending}
                    </span>
                    <span className="sr-only">
                      , {applicationCount(pending)} în așteptare
                    </span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The Administrare area (ruling R27, #825): the sections the viewer's
 * capabilities open, and the current section's page.
 *
 * - From 1024 px: one header, the sections as routed tabs, the page below;
 *   `/administrare` itself lands on the first tab the viewer may open.
 * - Under 1024 px, where three tabs of nine fit: `/administrare` is a menu of
 *   the sections, and each section's page has a back link to it and its own
 *   name as the title — no tab strip. A viewer with one section (the OSUBB
 *   Deals team) still lands straight in it.
 *
 * A link to `/administrare/<tab>` opens that page at every width. The page's
 * content sits in one `FabActions`, so a tab's create action (Invită membru,
 * Creează Grup, Deal nou) is the round plus button.
 *
 * Mounted behind `administer`; each tab's route is gated again on its own
 * capability, and the server decides every read and command a third time.
 * The Group and Member pages are sub-pages outside this frame (back link,
 * no tab bar). Cereri de aderare is the one tab shown by data, not only by
 * capability: it appears when one of the viewer's Groups takes Applications
 * or still has one pending.
 */
export default function AdministrareLayout() {
  const capabilities = useCapabilities();
  const { pathname } = useLocation();
  const section = useEnterMotion<HTMLDivElement>(pathname);
  // Tailwind's `lg`. Without `matchMedia` (a test DOM) this is the wide layout.
  const wide = useMinWidth('64rem');
  const applicationsShown = useApplicationsTabShown(capabilities.data);
  const pendingApplications = usePendingApplicationCount();
  const allowed = allowedTabs(capabilities.data);
  // Cereri de aderare shows when it can hold something (relevance B55) —
  // and always while it is the page open, so a link to it keeps its tab.
  const tabs = allowed.filter(
    (tab) =>
      tab.path !== APPLICATIONS_TAB_PATH ||
      applicationsShown === true ||
      pathname.startsWith(APPLICATIONS_TAB_PATH),
  );

  // No capability row yet: decide nothing (the route guard waits the same way).
  if (capabilities.data === undefined) return null;
  if (pathname.replace(/\/+$/, '') === ADMINISTRARE_PATH) {
    if (wide) return <Navigate to={tabs[0]?.path ?? '/'} replace />;
    // Whether this is a menu of two or a single page is not known until
    // Cereri de aderare is: wait, so the menu is never skipped by mistake.
    if (applicationsShown === undefined && allowed.length !== tabs.length)
      return null;
    if (tabs.length < 2) return <Navigate to={tabs[0]?.path ?? '/'} replace />;
    return (
      <Page>
        {/* No eyebrow: Administrare is the area itself (ruling 2, F-24). */}
        <PageHeader title="Administrare" />
        <SectionMenu tabs={tabs} pendingApplications={pendingApplications} />
      </Page>
    );
  }

  const current = tabs.find(
    (tab) => pathname === tab.path || pathname.startsWith(`${tab.path}/`),
  );
  // One section needs neither a strip nor a way back: the page carries it.
  const several = tabs.length > 1;

  return (
    <Page>
      <FabActions>
        {several && !wide && (
          <BackLink to={ADMINISTRARE_PATH} label="Administrare" />
        )}
        <PageHeader
          title={several && !wide && current ? current.label : 'Administrare'}
        />
        {several && wide && (
          <PageTabs
            label={NAV_LABEL}
            // Up to nine sections: below 1536 px only the current one
            // spells its name, the rest are their icons.
            labelsFrom="2xl"
            tabs={tabs.map((tab) => ({
              to: tab.path,
              label: tab.label,
              icon: tab.icon,
            }))}
          />
        )}
        {/* The section under the strip arrives; the strip itself stays. */}
        <div ref={section} className="flex min-w-0 flex-col gap-6">
          <Outlet />
        </div>
      </FabActions>
    </Page>
  );
}
