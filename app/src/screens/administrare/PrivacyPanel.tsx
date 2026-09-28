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

/** This tab: the notice and the member page both come back here. */
const PANEL_PATH = '/administrare/confidentialitate';

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
          <Link
            className="underline underline-offset-4"
            to="/confidentialitate"
            state={{
              from: { to: PANEL_PATH, label: 'Înapoi la Administrare' },
            }}
          >
            politicii de confidențialitate
          </Link>
          {version ? ` (v${version})` : ''}. Confirmarea nu este un
          consimțământ: arată doar că au fost informați.
        </>
      }
      stack={3}
    >
      {status.isPending || namesPending ? (
        <p role="status" className="m-0">
          Se încarcă confirmările…
        </p>
      ) : status.isError || members.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="m-0">Nu am putut încărca confirmările.</p>
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
        <p role="status" className="m-0">
          Toți membrii activi au confirmat versiunea curentă.
        </p>
      ) : (
        <>
          <p role="status" className="m-0 font-medium">
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
                    className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline underline-offset-4"
                    to={`/administrare/membri/${row.memberId}`}
                    state={{
                      from: {
                        to: PANEL_PATH,
                        label: 'Înapoi la Confidențialitate',
                      },
                    }}
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
                {/* The heading already says none of them confirmed the
                    current version; a row adds only an older one (B62). */}
                {row.noticeVersion && (
                  <p className="m-0 text-sm text-muted-foreground">
                    ultima confirmare: {acknowledgementLabel(row)}
                  </p>
                )}
              </ListRow>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
