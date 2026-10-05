import { formatMemberCount } from '../../lib/format';

/**
 * The quiet count over a list of Members: "12 membri", or "3 din 12 membri"
 * while a filter narrows it, with the Romanian plural ("1 membru",
 * "20 de membri"). Shared by Voluntari and Administrare › Membri (#1018), so
 * both say it in the same words and the same small muted type.
 */
export function MemberCount({
  shown,
  total,
}: {
  shown: number;
  total: number;
}) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {shown === total
        ? formatMemberCount(total)
        : `${new Intl.NumberFormat('ro-RO').format(shown)} din ${formatMemberCount(total)}`}
    </p>
  );
}
