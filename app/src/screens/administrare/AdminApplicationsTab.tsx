import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { Link } from 'react-router';
import {
  EmptyState,
  ListRow,
  Panel,
  rowListClass,
} from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { ErrorState, Loading } from '../../components/states';
import { useManagedGroupApplications } from '../../queries/group-applications';
import { ApplicationAction } from '../groups/ApplicationAction';

/**
 * Administrare → Cereri (#825, decision D3): the pending Group Applications
 * of every Group the viewer manages, oldest first, each decided in place with
 * the same command as the Group page's Cereri tab. Completed-work Requests
 * keep their own page (`/cereri`).
 */
export default function AdminApplicationsTab() {
  const applications = useManagedGroupApplications();
  const [decided, setDecided] = useState(false);

  return (
    <Panel eyebrow="Grupuri" icon={Inbox} title="Cereri de aderare">
      {decided && (
        <p role="status" className="m-0 mb-2 text-sm text-muted-foreground">
          Cererea a fost actualizată.
        </p>
      )}
      {applications.isPending ? (
        <Loading label="Se încarcă cererile…" />
      ) : applications.isError ? (
        <ErrorState
          text="Nu am putut încărca cererile."
          onRetry={() => void applications.refetch()}
        />
      ) : applications.data.length === 0 ? (
        <EmptyState icon={Inbox}>
          Nicio cerere de aderare în așteptare.
        </EmptyState>
      ) : (
        <ul className={rowListClass} aria-label="Cereri de aderare">
          {applications.data.map((row) => (
            <ListRow
              key={row.id}
              stackAction
              action={
                <>
                  <ApplicationAction
                    label="Acceptă"
                    onSuccess={() => setDecided(true)}
                    command={{
                      kind: 'decide',
                      applicationId: row.id,
                      accept: true,
                      note: '',
                    }}
                  />
                  <ApplicationAction
                    label="Respinge"
                    onSuccess={() => setDecided(true)}
                    command={{
                      kind: 'decide',
                      applicationId: row.id,
                      accept: false,
                      note: '',
                    }}
                  />
                </>
              }
            >
              <MemberName {...row.member} showFullName size="sm" />
              <p className="m-0 text-sm text-muted-foreground">
                <Link
                  to={`/administrare/grupuri/${row.group.id}`}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {row.group.name}
                </Link>{' '}
                · {new Date(row.created_at).toLocaleDateString('ro-RO')}
              </p>
              {row.note && (
                <p className="m-0 mt-1 text-sm whitespace-pre-wrap break-words">
                  {row.note}
                </p>
              )}
            </ListRow>
          ))}
        </ul>
      )}
    </Panel>
  );
}
