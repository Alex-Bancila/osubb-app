import { useDeals } from '../../queries/deals';
import { useMemberIdentities } from '../../queries/member-identities';
import {
  sortDeals,
  toDealPresentation,
  type DealPresentation,
} from './deals-presentation';

/** Every Deal the server lets the viewer read, newest first, authors named. */
export function useDealList() {
  const query = useDeals();
  const rows = query.data ?? [];
  const authors = useMemberIdentities(
    rows.flatMap((row) => (row.created_by ? [row.created_by] : [])),
  );
  const deals: DealPresentation[] = sortDeals(
    rows.map((row) => toDealPresentation(row, authors.data)),
  );
  return { query, deals };
}
