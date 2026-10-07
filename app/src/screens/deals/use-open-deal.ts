import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMarkAnnouncementRead } from '../../queries/announcements';
import { DEAL_PARAM, type DealPresentation } from './deals-presentation';

function parseDealId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Which Deal's sheet is open, for the Deals tab and the team's page alike:
 * opening one marks it read (it is an Announcement, so its "Deal nou"
 * notification goes read with it), and `?deal=<id>` — the link the
 * notification carries — opens it once the list is in, or the unavailable
 * state when the viewer cannot read it (R45: expired for members).
 */
export function useOpenDeal(
  deals: readonly DealPresentation[],
  ready: boolean,
  memberId: string | undefined,
) {
  const markRead = useMarkAnnouncementRead(memberId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const marked = useRef(new Set<number>());
  const handledParam = useRef<string | null>(null);

  // Once per Deal per visit, however it is engaged with.
  function markAsRead(deal: DealPresentation) {
    if (deal.isRead || marked.current.has(deal.id)) return;
    marked.current.add(deal.id);
    markRead.mutate(deal.id, {
      onError: () => marked.current.delete(deal.id),
    });
  }

  function open(deal: DealPresentation) {
    setUnavailable(false);
    setSelectedId(deal.id);
    markAsRead(deal);
  }

  const paramValue = searchParams.get(DEAL_PARAM);
  useEffect(() => {
    if (paramValue === null) {
      handledParam.current = null;
      return;
    }
    if (!ready || handledParam.current === paramValue) return;
    handledParam.current = paramValue;
    const id = parseDealId(paramValue);
    const linked = id === null ? undefined : deals.find((d) => d.id === id);
    if (linked) open(linked);
    else {
      setSelectedId(null);
      setUnavailable(true);
    }
    // Once per link: the handled ref keeps a refetch from reopening it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramValue, ready]);

  function close() {
    setSelectedId(null);
    setUnavailable(false);
    if (searchParams.has(DEAL_PARAM)) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete(DEAL_PARAM);
          return next;
        },
        { replace: true },
      );
    }
  }

  return {
    selected: deals.find((deal) => deal.id === selectedId) ?? null,
    unavailable,
    open,
    close,
    /** Revealing the code from the card reads the Deal too. */
    markAsRead,
  };
}
