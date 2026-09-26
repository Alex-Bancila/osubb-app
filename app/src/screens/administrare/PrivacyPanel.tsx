import { useMemo } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { formatMemberCount } from '../../lib/format';
import { useAppointableMembers } from '../../queries/groups-admin';
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
  const members = useAppointableMembers();
  const names = useMemo(
    () => new Map((members.data ?? []).map((row) => [row.memberId, row.name])),
    [members.data],
  );
  const missing = useMemo(
    () =>
      status.data
        ? missingAcknowledgements(status.data).sort((left, right) =>
            (names.get(left.memberId) ?? '').localeCompare(
              names.get(right.memberId) ?? '',
              'ro',
            ),
          )
        : [],
    [status.data, names],
  );
  const version = status.data?.currentVersion;

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
      {status.isPending || members.isPending ? (
        <p role="status">Se încarcă confirmările…</p>
      ) : status.isError || members.isError ? (
        <div role="alert" className="space-y-3">
          <p>Nu am putut încărca confirmările.</p>
          <Button
            variant="outline"
            onClick={() => {
              void status.refetch();
              void members.refetch();
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
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  to={`/administrare/membri/${row.memberId}`}
                >
                  {names.get(row.memberId) ?? 'Membru'}
                </Link>
                <span className="text-sm text-muted-foreground">
                  {row.noticeVersion
                    ? `ultima confirmare: ${acknowledgementLabel(row)}`
                    : 'neconfirmată'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
