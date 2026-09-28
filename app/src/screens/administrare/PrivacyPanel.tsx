import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { ListRow, Panel, rowListClass } from '../../components/layout';
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
    <Panel
      eyebrow="Membri"
      icon={ShieldCheck}
      title="Confidențialitate"
      description={
        <>
          Membrii activi care nu au confirmat că au citit versiunea curentă a{' '}
          <Link className="underline" to="/confidentialitate">
            politicii de confidențialitate
          </Link>
          {version ? ` (v${version})` : ''}. Confirmarea nu este un
          consimțământ: arată doar că au fost informați.
        </>
      }
      boxClassName="space-y-4"
    >
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
          <ul className={rowListClass}>
            {missing.map((row) => (
              <ListRow
                key={row.memberId}
                stackAction
                action={
                  <Link
                    className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4"
                    to={`/administrare/membri/${row.memberId}`}
                  >
                    Pagina membrului
                  </Link>
                }
              >
                <MemberName
                  {...(members.data?.get(row.memberId) ?? {
                    memberId: row.memberId,
                    fullName: 'Membru OSUBB',
                  })}
                  showFullName
                  size="sm"
                />
                <p className="m-0 text-sm text-muted-foreground">
                  {row.noticeVersion
                    ? `ultima confirmare: ${acknowledgementLabel(row)}`
                    : 'neconfirmată'}
                </p>
              </ListRow>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
