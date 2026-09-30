import { Panel } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { formatPoints } from '../../lib/format';
import { useMyRoleLabel } from '../../queries/my-role-label';
import { useMyPoints } from '../../queries/points';

/**
 * The Member's Personal Score (CONTEXT.md) above Taskurile mele, ruling R10:
 * the `my_points` total and the Role label, as Acasă shows them. No rank —
 * ranking is a leadership view (ADR-0007), so nothing here asks for one.
 *
 * A `Panel` stat (layout T6): the kit's 19 px title above one box, the total
 * on the left and the Role chip on the right, like Acasă's Punctajul meu.
 */
export function PersonalScoreHeader() {
  const points = useMyPoints();
  /* The label comes from `roles` ("Membru cu Drept de Vot"), with the enum
     value as the fallback while it loads — never a blank chip (#963: the
     Board Title for a member who holds one). */
  const roleLabel = useMyRoleLabel();

  return (
    <Panel title="Punctajul meu" className="h-auto">
      <div
        data-slot="personal-score"
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
      >
        {points.isPending ? (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            Se încarcă punctajul…
          </p>
        ) : points.isError ? (
          <div role="alert" className="flex flex-col gap-2 text-sm">
            <p className="m-0">Nu am putut încărca punctajul.</p>
            <Button
              variant="outline"
              className="self-start"
              onClick={() => void points.refetch()}
            >
              Reîncarcă punctajul
            </Button>
          </div>
        ) : (
          <p className="m-0 flex items-baseline gap-2 leading-none">
            <span className="text-[length:var(--fs-3xl)] font-extrabold tracking-[-0.03em] tabular-nums">
              {formatPoints(points.data)}
            </span>
            <span className="text-[length:var(--fs-md)] font-semibold text-muted-foreground">
              puncte
            </span>
          </p>
        )}
        {roleLabel && (
          <p className="m-0 inline-flex max-w-full items-center gap-1.5 rounded-full bg-(--ink-900) py-1 pr-3 pl-2.5 text-[length:var(--fs-xs)] font-bold wrap-anywhere text-(--white)">
            <span
              aria-hidden="true"
              className="size-[7px] shrink-0 rounded-full bg-(--red)"
            />
            {roleLabel}
          </p>
        )}
      </div>
    </Panel>
  );
}
