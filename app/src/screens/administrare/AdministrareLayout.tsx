import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Page, PageHeader, PageTabs } from '../../components/layout';
import { useCapabilities } from '../../lib/capabilities';
import {
  ADMINISTRARE_PATH,
  allowedTabs,
  type AdministrareOutletContext,
} from './administrare-tabs';

/**
 * The Administrare area (ruling R27, #825): one header, the routed tabs the
 * viewer's capabilities open, and the current tab's page below them.
 * `/administrare` itself lands on the first tab the viewer may open.
 *
 * Mounted behind `administer`; each tab's route is gated again on its own
 * capability, and the server decides every read and command a third time.
 * The Group and Member pages are sub-pages outside this frame (back link,
 * no tab bar).
 */
export default function AdministrareLayout() {
  const capabilities = useCapabilities();
  const { pathname } = useLocation();
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  const tabs = allowedTabs(capabilities.data);

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
      <PageHeader
        eyebrow="OSUBB · Administrare"
        title="Administrare"
        description={
          capabilities.data?.createTopLevelGroups === true
            ? 'Grupurile OSUBB, membrii, rolurile și setările organizației.'
            : 'Grupurile pe care le coordonezi.'
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
      <PageTabs
        label="Secțiunile administrării"
        tabs={tabs.map((tab) => ({ to: tab.path, label: tab.label }))}
      />
      <Outlet context={context} />
    </Page>
  );
}
