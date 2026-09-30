import { Link } from 'react-router';
import { cn } from 'cn';
import { focusRingClass } from '../../components/layout';
import { formatPoints, pointWord } from '../../lib/format';
import { useMyRoleLabel } from '../../queries/my-role-label';
import { useMyPoints } from '../../queries/points';

/**
 * The Member's points and Role on Acasă's greeting line (#859, Alex
 * 2026-09-28: "an entire card for 3 words, it is too big"): **14 puncte ·
 * Voluntar**, one link to Profil, where the total is explained. No box, no
 * border — the number in the dashboard's figure style, smaller. Rendered only
 * below BCE (the page decides): BC and BCE do not work by points.
 *
 * Nothing shows until the total has arrived, and nothing on a failed read:
 * a stat is not worth an error on the greeting, and Profil has the details.
 * No rank: the ranking lives on Clasament (ADR-0007).
 */
export default function PointsStat() {
  const points = useMyPoints();
  /* The Role label comes from the `roles` table ("Membru cu Drept de Vot"),
     with the enum value as the fallback while it loads (#963: the Board
     Title for a member who holds one). */
  const roleLabel = useMyRoleLabel();

  if (points.data === undefined) return null;

  return (
    <Link
      to="/profil"
      data-slot="points-stat"
      className={cn(
        'group inline-flex min-h-11 max-w-full flex-wrap items-baseline gap-x-2 gap-y-1 rounded-sm py-2 leading-none text-foreground',
        focusRingClass,
      )}
    >
      <span className="inline-flex items-baseline gap-1.5">
        <span
          data-slot="points-value"
          className="text-[length:var(--fs-xl)] font-extrabold tracking-[-0.03em] tabular-nums"
        >
          {formatPoints(points.data)}
        </span>
        <span className="text-sm font-semibold text-muted-foreground">
          {pointWord(points.data)}
        </span>
      </span>
      {roleLabel && (
        <>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold underline-offset-4 group-hover:underline">
            <span
              aria-hidden="true"
              className="size-[7px] shrink-0 rounded-full bg-(--red)"
            />
            {roleLabel}
          </span>
        </>
      )}
    </Link>
  );
}
