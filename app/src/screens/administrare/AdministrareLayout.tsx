import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Page, PageHeader, PageTabs } from '../../components/layout';
import { useCapabilities } from '../../lib/capabilities';
import {
  ADMINISTRARE_PATH,
  APPLICATIONS_TAB_PATH,
  allowedTabs,
  type AdministrareOutletContext,
} from './administrare-tabs';
import { useApplicationsTabShown } from './applications-tab';

/**
 * The Administrare area (ruling R27, #825): one header, the routed tabs the
 * viewer's capabilities open, and the current tab's page below them.
 * `/administrare` itself lands on the first tab the viewer may open.
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
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  const applicationsShown = useApplicationsTabShown(capabilities.data);
  // Cereri de aderare shows when it can hold something (relevance B55) —
  // and always while it is the page open, so a link to it keeps its tab.
  const tabs = allowedTabs(capabilities.data).filter(
    (tab) =>
      tab.path !== APPLICATIONS_TAB_PATH ||
      applicationsShown === true ||
      pathname.startsWith(APPLICATIONS_TAB_PATH),
  );

  // No capability row yet: decide nothing (the route guard waits the same way).
  if (capabilities.data === undefined) return null;
  if (pathname.replace(/\/+$/, '') === ADMINISTRARE_PATH)
    return <Navigate to={tabs[0]?.path ?? '/'} replace />;

  const current = tabs.find(
    (tab) => pathname === tab.path || pathname.startsWith(`${tab.path}/`),
  );
  const hasAction =
    capabilities.data !== undefined &&
    current?.hasHeaderAction?.(capabilities.data) === true;
  const context: AdministrareOutletContext = {
    actionSlot: hasAction ? actionSlot : null,
  };

  return (
    <Page>
      {/* No eyebrow: Administrare is the area itself (ruling 2, F-24). */}
      <PageHeader
        title="Administrare"
        description={
          capabilities.data?.createTopLevelGroups === true
            ? 'Grupurile OSUBB, membrii, rolurile și setările organizației.'
            : 'Grupurile în care ai o funcție.'
        }
        actions={
          hasAction ? (
            <div
              ref={setActionSlot}
              data-slot="administrare-actions"
              className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto *:max-sm:w-full"
            />
          ) : undefined
        }
      />
      {/* One section needs no strip: the title and the page carry it. */}
      {tabs.length > 1 && (
        <PageTabs
          label="Secțiunile administrării"
          tabs={tabs.map((tab) => ({ to: tab.path, label: tab.label }))}
        />
      )}
      <Outlet context={context} />
    </Page>
  );
}
