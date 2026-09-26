import { useMemo } from 'react';
import { Link } from 'react-router';
import { MemberName } from '../../components/member/MemberName';
import { memberDisplayName } from '../../components/member/member-identity';
import { Button } from '../../components/ui/button';
import { formatMemberCount } from '../../lib/format';
import { useMemberIdentities } from '../../queries/member-identities';
import {
  acknowledgementLabel,
  missingAcknowledgements,
  usePrivacyStatus,
} from '../../queries/privacy';

/**
 * Administrare's "Confidențialitate" panel (#771, ruling L16): the active
 * Members who have not acknowledged the current Privacy Notice version, with
 * a count, so BC can remind them. Mounted behind `manageRoles` (level >= 6),
 * the same rank the status read requires on the server.
 */
export function PrivacyPanel() {
  const status = usePrivacyStatus();
  const unacknowledged = useMemo(
    () => (status.data ? missingAcknowledgements(status.data) : []),
    [status.data],
  );
  // Names as Member Card buttons (Nickname first, R5): one directory read.
  const members = useMemberIdentities(
    unacknowledged.map((row) => row.memberId),
  );
  const missing = useMemo(() => {
    const name = (memberId: string) => {
      const identity = members.data?.get(memberId);
      return identity
        ? memberDisplayName(identity.nickname, identity.fullName)
        : '';
    };
    return [...unacknowledged].sort((left, right) =>
      name(left.memberId).localeCompare(name(right.memberId), 'ro'),
    );
  }, [unacknowledged, members.data]);
  const version = status.data?.currentVersion;
  // No ids means no directory read at all (the query is skipped, not loading).
  const namesPending = unacknowledged.length > 0 && members.isPending;

  return (
    <section
      aria-labelledby="privacy-title"
      className="space-y-4 rounded-xl border bg-card p-4 md:p-5"
    >
      <div>
        <h2 id="privacy-title" className="text-xl font-semibold">
          Confidențialitate
        </h2>
        <p className="text-sm text-muted-foreground">
          Membrii activi care nu au confirmat că au citit versiunea curentă a{' '}
          <Link className="underline" to="/confidentialitate">
            politicii de confidențialitate
          </Link>
          {version ? ` (v${version})` : ''}. Confirmarea nu este un
          consimțământ: arată doar că au fost informați.
        </p>
      </div>
      {status.isPending || namesPending ? (
        <p role="status">Se încarcă confirmările…</p>
      ) : status.isError || members.isError ? (
        <div role="alert" className="space-y-3">
          <p>Nu am putut încărca confirmările.</p>
          <Button
            variant="outline"
            onClick={() => {
              void status.refetch();
              if (members.isError) void members.refetch();
            }}
          >
            Încearcă din nou
          </Button>
        </div>
      ) : missing.length === 0 ? (
        <p role="status">Toți membrii activi au confirmat versiunea curentă.</p>
      ) : (
        <>
          <p role="status" className="font-medium">
            {formatMemberCount(missing.length)} fără confirmarea versiunii
            curente
          </p>
          <ul className="divide-y">
            {missing.map((row) => (
              <li
                key={row.memberId}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <MemberName
                  {...(members.data?.get(row.memberId) ?? {
                    memberId: row.memberId,
                    fullName: 'Membru OSUBB',
                  })}
                  showFullName
                  size="sm"
                />
                <span className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                  <span>
                    {row.noticeVersion
                      ? `ultima confirmare: ${acknowledgementLabel(row)}`
                      : 'neconfirmată'}
                  </span>
                  <Link
                    className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4"
                    to={`/administrare/membri/${row.memberId}`}
                  >
                    Pagina membrului
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
