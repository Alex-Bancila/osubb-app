import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Loading } from '../../components/states';
import { buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useGroupApplications } from '../../queries/group-applications';
import { useGroups } from '../../queries/reference';
import { ApplicationAction } from '../groups/ApplicationAction';

/**
 * The joining half of **Grupurile mele** (ruling R18, below level 5): the
 * Member's pending Applications, each with #589's withdraw, and the way to
 * `/grupuri` to apply to another Group. Mounted only below level 5, so a
 * leader's Profil never asks for Applications at all.
 *
 * A withdrawn Application leaves the list as soon as the refetch lands, taking
 * its button and dialog with it, so the confirmation lives here and focus moves
 * to the link that stays.
 */
export function JoiningSection() {
  const applications = useGroupApplications();
  const groups = useGroups();
  const applyLink = useRef<HTMLAnchorElement>(null);
  const [withdrawn, setWithdrawn] = useState<string | null>(null);

  return (
    <div
      className="mt-6 flex flex-col gap-4 border-t border-border pt-4"
      data-testid="joining-section"
    >
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Cereri în așteptare
        </h4>
        {applications.isPending ? (
          <Loading label="Se încarcă cererile…" />
        ) : applications.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Nu am putut încărca cererile. Reîncarcă pagina.
          </p>
        ) : applications.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nicio cerere în așteptare.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {applications.data.map((application) => {
              const group = groups.data?.get(application.group_id);
              const groupName = group?.name ?? 'Grup';
              return (
                <li
                  key={application.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{
                        backgroundColor: group?.color ?? 'var(--brand-red)',
                      }}
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm font-semibold text-foreground">
                      {groupName}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ApplicationAction
                      label="Retrage aplicația"
                      command={{
                        kind: 'withdraw',
                        applicationId: application.id,
                      }}
                      onSuccess={() => {
                        setWithdrawn(groupName);
                        applyLink.current?.focus();
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {/* Always mounted, so the confirmation is announced when it appears. */}
        <p
          role="status"
          className={cn('text-sm text-muted-foreground', withdrawn && 'mt-2')}
        >
          {withdrawn && `Cererea pentru ${withdrawn} a fost retrasă.`}
        </p>
      </div>

      <Link
        ref={applyLink}
        to="/grupuri"
        className={cn(buttonVariants({ variant: 'outline' }), 'self-start')}
      >
        Aplică la un grup
      </Link>
    </div>
  );
}
