import { useGroupApplications } from '../../queries/group-applications';
import { ApplicationAction } from '../groups/ApplicationAction';

export function GroupApplicationsTab({
  groupId,
  canDecide,
}: {
  groupId: number;
  canDecide: boolean;
}) {
  const applications = useGroupApplications(groupId);
  if (applications.isPending) return <p role="status">Se încarcă cererile…</p>;
  if (applications.isError)
    return <p role="alert">Nu am putut încărca cererile. Reîncarcă pagina.</p>;
  if (!applications.data.length) return <p>Nu sunt cereri în așteptare.</p>;
  return (
    <ul className="space-y-4">
      {applications.data.map((row) => (
        <li key={row.id} className="space-y-3 rounded-xl border p-4">
          <h3 className="font-semibold">{row.memberName}</h3>
          <p className="text-sm text-muted-foreground">
            {new Date(row.created_at).toLocaleDateString('ro-RO')}
          </p>
          {row.note && (
            <p className="whitespace-pre-wrap break-words">{row.note}</p>
          )}
          {canDecide && (
            <div className="flex flex-wrap gap-3">
              <ApplicationAction
                label="Acceptă"
                command={{
                  kind: 'decide',
                  applicationId: row.id,
                  accept: true,
                  note: '',
                }}
              />
              <ApplicationAction
                label="Respinge"
                command={{
                  kind: 'decide',
                  applicationId: row.id,
                  accept: false,
                  note: '',
                }}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
