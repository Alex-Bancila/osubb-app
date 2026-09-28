import { ListRow, rowListClass } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { Empty, ErrorState, Loading } from '../../components/states';
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
  if (applications.isPending) return <Loading label="Se încarcă cererile…" />;
  if (applications.isError)
    return (
      <ErrorState text="Nu am putut încărca cererile. Reîncarcă pagina." />
    );
  if (!applications.data.length)
    return <Empty text="Nu sunt cereri în așteptare." />;
  return (
    <ul className={rowListClass}>
      {applications.data.map((row) => (
        <ListRow
          key={row.id}
          stackAction
          action={
            canDecide && (
              <>
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
              </>
            )
          }
        >
          <h3 className="m-0 text-base font-normal">
            <MemberName {...row.member} showFullName size="sm" />
          </h3>
          <p className="m-0 text-sm text-muted-foreground">
            {new Date(row.created_at).toLocaleDateString('ro-RO')}
          </p>
          {row.note && (
            <p className="m-0 mt-1 text-sm whitespace-pre-wrap break-words">
              {row.note}
            </p>
          )}
        </ListRow>
      ))}
    </ul>
  );
}
