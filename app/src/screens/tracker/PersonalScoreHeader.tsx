import { Button } from '../../components/ui/button';
import { formatPoints } from '../../lib/format';
import { useMyPoints } from '../../queries/points';
import { useMyProfile } from '../../queries/profile';
import { useRoles } from '../../queries/reference';

/**
 * The Member's Personal Score (CONTEXT.md) above Taskurile mele, ruling R10:
 * the `my_points` total and the Role label, as Acasă shows them. No rank —
 * ranking is a leadership view (ADR-0007), so nothing here asks for one.
 */
export function PersonalScoreHeader() {
  const points = useMyPoints();
  const profile = useMyProfile();
  const roles = useRoles();

  if (points.isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Se încarcă punctajul…
      </p>
    );
  if (points.isError)
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>Nu am putut încărca punctajul.</p>
        <Button
          variant="outline"
          className="min-h-11 min-w-11"
          onClick={() => void points.refetch()}
        >
          Reîncarcă punctajul
        </Button>
      </div>
    );

  /* The label comes from `roles` ("Membru cu Drept de Vot"), with the enum
     value as the fallback while it loads — never a blank chip. */
  const role = profile.data?.role;
  const roleLabel = (role && roles.data?.get(role)?.name) ?? role ?? '';

  return (
    <section
      aria-labelledby="personal-score-title"
      data-slot="personal-score"
      className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-4"
    >
      <div className="min-w-0">
        <h2
          id="personal-score-title"
          className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase"
        >
          <span
            aria-hidden="true"
            className="h-3 w-1 rounded-full bg-primary"
          />
          Punctajul meu
        </h2>
        <p className="mt-1 flex items-baseline gap-2 leading-none">
          <span className="text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">
            {formatPoints(points.data)}
          </span>
          <span className="text-base font-semibold text-muted-foreground">
            puncte
          </span>
        </p>
      </div>
      {roleLabel && (
        <p className="inline-flex max-w-full items-center rounded-full border border-border px-3 py-1 text-xs font-medium wrap-anywhere">
          {roleLabel}
        </p>
      )}
    </section>
  );
}
