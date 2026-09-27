import { Award } from 'lucide-react';
import { Panel } from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { formatPoints } from '../../lib/format';
import { useMyPoints } from '../../queries/points';
import { useMyProfile } from '../../queries/profile';
import { useRoles } from '../../queries/reference';

/**
 * **Punctajul meu** (#93, #822): a Member's total and their Role. Shown below
 * BCE only — the page decides — and without a rank: the ranking is a
 * leadership view that lives on Clasament (ADR-0007).
 */
export default function MyPointsCard({ className }: { className?: string }) {
  const points = useMyPoints();
  const profile = useMyProfile();
  const roles = useRoles();

  /* The Role label comes from the `roles` table ("Membru cu Drept de Vot"),
     with the enum value as the fallback while it loads — never a blank chip. */
  const role = profile.data?.role;
  const roleLabel = (role && roles.data?.get(role)?.name) ?? role ?? '';

  return (
    <Panel
      eyebrow="Punctaj"
      icon={Award}
      title="Punctajul meu"
      className={className}
    >
      {points.isError ? (
        <ErrorState
          error={points.error}
          onRetry={() => void points.refetch()}
        />
      ) : points.isPending ? (
        <Loading />
      ) : (
        <div className="flex h-full flex-col justify-center gap-4 py-2">
          <p className="m-0 flex items-baseline gap-2 leading-none">
            <span
              data-slot="points-value"
              className="text-[length:var(--fs-3xl)] font-extrabold tracking-[-0.03em] tabular-nums"
            >
              {formatPoints(points.data)}
            </span>
            <span className="text-[length:var(--fs-md)] font-semibold text-muted-foreground">
              puncte
            </span>
          </p>
          {roleLabel && (
            <p className="m-0">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-(--ink-900) py-1 pr-3 pl-2.5 text-[length:var(--fs-xs)] font-bold text-(--white)">
                <span
                  aria-hidden="true"
                  className="size-[7px] rounded-full bg-(--red)"
                />
                {roleLabel}
              </span>
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
