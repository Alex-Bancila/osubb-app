import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { buttonVariants } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/utils';
import { useGroupApplications } from '../../queries/group-applications';
import { useAdminGroups } from '../../queries/groups-admin';
import { useGroups, useMyGroups } from '../../queries/reference';
import { ApplicationAction } from '../groups/ApplicationAction';
import { acceptsApplication } from '../groups/application-eligibility';

/**
 * The joining half of **Grupurile mele** (ruling R18, below level 5): the
 * Member's pending Applications, each with #589's withdraw, and the way to
 * `/grupuri` to apply to another Group. Mounted only below level 5, so a
 * leader's Profil never asks for Applications at all.
 *
 * Each part shows only when it has something in it (#859): no "Cereri în
 * așteptare" heading over nothing (B41), and **Aplică la un grup** only while
 * at least one Group would take this Member's Application — one they are not
 * in and have not applied to already (B42, the rule of Grupuri's "Poți aplica
 * la"). With neither, only the (empty) confirmation line is mounted.
 *
 * A withdrawn Application leaves the list as soon as the refetch lands, taking
 * its button and dialog with it, so the confirmation lives here and focus moves
 * to the link that stays.
 */
export function JoiningSection() {
  const applications = useGroupApplications();
  const groups = useGroups();
  const readable = useAdminGroups();
  const memberships = useMyGroups().membershipRows;
  const level = useAuth().claims?.member_level ?? 0;
  const applyLink = useRef<HTMLAnchorElement>(null);
  const [withdrawn, setWithdrawn] = useState<string | null>(null);

  const pending = applications.data ?? [];
  const taken = new Set([
    ...(memberships ?? []).map((row) => row.group_id),
    ...pending.map((application) => application.group_id),
  ]);
  const canApply = (readable.data ?? []).some(
    (group) => acceptsApplication(group, level) && !taken.has(group.id),
  );
  const showPending = applications.isError || pending.length > 0;

  // Always mounted, so the confirmation is announced when it appears.
  const status = (
    <p role="status" className="m-0 text-sm text-muted-foreground empty:hidden">
      {withdrawn && `Cererea pentru ${withdrawn} a fost retrasă.`}
    </p>
  );

  if (!showPending && !canApply) return status;

  return (
    <div
      className="mt-4 flex flex-col gap-4 border-t border-border pt-4"
      data-testid="joining-section"
    >
      {showPending && (
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Cereri în așteptare
          </h3>
          {applications.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Nu am putut încărca cererile. Reîncarcă pagina.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {pending.map((application) => {
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
                      <span className="text-sm font-semibold wrap-anywhere text-foreground">
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
        </div>
      )}
      {status}
      {canApply && (
        <Link
          ref={applyLink}
          to="/grupuri"
          className={cn(buttonVariants({ variant: 'outline' }), 'self-start')}
        >
          Aplică la un grup
        </Link>
      )}
    </div>
  );
}
