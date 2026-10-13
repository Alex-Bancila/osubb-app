import { useState } from 'react';
import { PageGrid, SectionHeader } from '../../components/layout';
import { Empty, ErrorState, Loading } from '../../components/states';
import { useAuth } from '../../lib/auth';
import DealCard from './DealCard';
import DealDetailsSheet, {
  DealManageActions,
  DealRevealCount,
} from './DealDetailsSheet';
import { NewDealControl } from './DealFormSheet';
import { DealsTeamPanel } from './DealsTeamPanel';
import { isDealActive } from './deals-presentation';
import { useDealList } from './use-deal-list';
import { useDealsViewer } from './use-deals-viewer';
import { useOpenDeal } from './use-open-deal';

/**
 * Administrare › OSUBB Deals (ruling R47): the team, then every Deal —
 * active and expired — each with Editează and Șterge as the viewer may, and
 * how many Members opened its code. Every BC member and the Moderator see it
 * with Deal nou, Editează, Șterge and both team pickers; the Coordonator the
 * same except the Coordonator picker; the Responsabil sees the list, Deal nou
 * and their own Deals' Editează and Șterge.
 */
export default function DealsAdminTab() {
  const memberId = useAuth().session?.user.id;
  const viewer = useDealsViewer();
  const { query, deals } = useDealList();
  const sheet = useOpenDeal(
    deals,
    !query.isPending && !query.isError,
    memberId,
  );
  const [deleted, setDeleted] = useState(false);
  const active = deals.filter((deal) => isDealActive(deal)).length;

  return (
    <>
      {/* Deal nou: the page's plus button in Administrare. */}
      {viewer.manageDeals && <NewDealControl />}
      <DealsTeamPanel />

      <section aria-labelledby="deals-admin-list" className="space-y-4">
        <SectionHeader
          titleId="deals-admin-list"
          title="Deal-uri"
          description={
            deals.length === 0
              ? undefined
              : `${active} active · ${deals.length - active} expirate`
          }
        />
        {deleted && (
          <p
            role="status"
            className="m-0 text-sm text-emerald-700 dark:text-emerald-400"
          >
            Deal-ul a fost șters.
          </p>
        )}
        {query.isPending ? (
          <Loading label="Se încarcă deal-urile…" />
        ) : query.isError ? (
          <ErrorState
            error={query.error}
            text="Nu am putut încărca deal-urile."
            onRetry={() => void query.refetch()}
          />
        ) : deals.length === 0 ? (
          <Empty
            bare
            text={
              viewer.manageDeals
                ? 'Niciun deal încă. Publică primul cu „Deal nou”.'
                : 'Niciun deal publicat.'
            }
          />
        ) : (
          <PageGrid
            columns={1}
            as="ul"
            role="list"
            aria-label="Toate deal-urile"
          >
            {deals.map((deal) => (
              <li key={deal.id}>
                <DealCard
                  deal={deal}
                  onOpen={(opened) => {
                    setDeleted(false);
                    sheet.open(opened);
                  }}
                  footerMeta={
                    deal.code && (
                      <DealRevealCount
                        dealId={deal.id}
                        className="m-0 flex items-center gap-1.5 text-xs text-muted-foreground"
                      />
                    )
                  }
                  footerActions={
                    <DealManageActions
                      deal={deal}
                      viewer={viewer}
                      compact
                      onDeleted={() => setDeleted(true)}
                    />
                  }
                />
              </li>
            ))}
          </PageGrid>
        )}
      </section>

      <DealDetailsSheet
        deal={sheet.selected}
        unavailable={sheet.unavailable}
        onClose={sheet.close}
        onDeleted={() => {
          sheet.close();
          setDeleted(true);
        }}
      />
    </>
  );
}
