import { useState } from 'react';
import { PageGrid } from '../../components/layout';
import { Empty, ErrorState, Loading } from '../../components/states';
import { useAuth } from '../../lib/auth';
import DealCard from './DealCard';
import DealDetailsSheet from './DealDetailsSheet';
import { isDealActive } from './deals-presentation';
import { useDealList } from './use-deal-list';
import { useOpenDeal } from './use-open-deal';

/**
 * Anunțuri › OSUBB Deals (ruling R45): the Deals still within their Termen,
 * newest first, for every active Member. The server already hides an expired
 * Deal from a member; the team, BC and the Moderator read expired ones too,
 * and those wait on Administrare › OSUBB Deals, not here. `?deal=<id>` opens
 * one.
 */
export default function DealsTab() {
  const memberId = useAuth().session?.user.id;
  const { query, deals: all } = useDealList();
  const deals = all.filter((deal) => isDealActive(deal));
  const sheet = useOpenDeal(
    deals,
    !query.isPending && !query.isError,
    memberId,
  );
  const [deleted, setDeleted] = useState(false);

  return (
    <>
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
          text="Niciun deal activ acum. Când echipa OSUBB Deals publică unul, primești o notificare."
        />
      ) : (
        <PageGrid columns={1} as="ul" role="list" aria-label="Deal-uri OSUBB">
          {deals.map((deal) => (
            <li key={deal.id}>
              <DealCard
                deal={deal}
                onOpen={(opened) => {
                  setDeleted(false);
                  sheet.open(opened);
                }}
              />
            </li>
          ))}
        </PageGrid>
      )}
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
