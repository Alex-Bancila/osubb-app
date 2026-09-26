import { Link, useParams } from 'react-router';
import { PrivateGroupBadge } from '../../components/group/PrivateGroupBadge';
import { Badge } from '../../components/ui/badge';
import { useAuth } from '../../lib/auth';
import { useCapabilities } from '../../lib/capabilities';
import { MemberName } from '../../components/member/MemberName';
import {
  useAdminGroups,
  useMyGroupRoles,
  groupAuthority,
} from '../../queries/groups-admin';
import {
  useGroupApplications,
  useGroupCoordination,
  useGroupUpcomingEvents,
} from '../../queries/group-applications';
import { categoryLabel } from '../administrare/group-tree';
import { ApplicationAction } from './ApplicationAction';
import { ApplicationFormLink } from './ApplicationFormLink';
import { acceptsApplication, applicationForm } from './application-eligibility';

export default function MemberGroupScreen() {
  const id = Number(useParams().groupId);
  const groups = useAdminGroups();
  const mine = useMyGroupRoles();
  const applications = useGroupApplications();
  const roster = useGroupCoordination(id);
  const events = useGroupUpcomingEvents(id);
  const capabilities = useCapabilities();
  const auth = useAuth();
  const level = auth.claims?.member_level ?? 0;
  if (groups.isPending || mine.isPending || applications.isPending)
    return <p role="status">Se încarcă grupul…</p>;
  if (groups.isError || mine.isError || applications.isError)
    return <p role="alert">Nu am putut încărca grupul. Reîncarcă pagina.</p>;
  const group = groups.data.find((row) => row.id === id);
  if (!group)
    return (
      <section className="page">
        <h1>Grup indisponibil</h1>
        <Link to="/grupuri">Înapoi la grupuri</Link>
      </section>
    );
  const role = mine.data.find((row) => row.id === id);
  const pending = applications.data.find((row) => row.group_id === id);
  const form = applicationForm(group);
  const authority = groupAuthority(
    group,
    mine.data,
    capabilities.data?.createTopLevelGroups === true,
  );
  return (
    <section className="page space-y-6">
      <Link to="/grupuri" className="underline">
        Înapoi la grupuri
      </Link>
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1 h-6 w-6 rounded-full"
          style={{ backgroundColor: group.color ?? '#5C5C61' }}
        />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{group.name}</h1>
            <PrivateGroupBadge isPrivate={group.is_private} />
          </div>
          <p className="text-muted-foreground">
            {categoryLabel(group.category)}
          </p>
        </div>
      </header>
      {role && (
        <p>
          Rolul tău:{' '}
          <strong>
            {role.group_role === 'manager'
              ? (group.manager_title ?? 'Coordonator')
              : role.group_role === 'responsible'
                ? (roster.data?.find(
                    (row) => row.memberId === auth.session?.user.id,
                  )?.positionTitle ?? 'Responsabil')
                : 'Membru'}
          </strong>
        </p>
      )}
      {pending ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">Cerere în așteptare</Badge>
          <ApplicationAction
            label="Retrage aplicația"
            command={{ kind: 'withdraw', applicationId: pending.id }}
          />
        </div>
      ) : (
        !role?.explicit &&
        !role?.automatic &&
        acceptsApplication(group, level) &&
        (form ? (
          <ApplicationFormLink label={form.label} url={form.url} />
        ) : (
          <ApplicationAction
            label="Aplică"
            command={{ kind: 'apply', groupId: id, note: '' }}
          />
        ))
      )}
      {authority.manageWork && (
        <Link
          className="inline-flex min-h-11 items-center underline"
          to={`/administrare/grupuri/${id}`}
        >
          Administrare
        </Link>
      )}
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-lg font-semibold">Coordonare</h2>
        {roster.isPending ? (
          <p role="status">Se încarcă…</p>
        ) : roster.isError ? (
          <p role="alert">Nu am putut încărca funcțiile din grup.</p>
        ) : !roster.data.some((row) => row.groupRole !== 'member') ? (
          <p>Nu sunt numite funcții de coordonare în acest grup.</p>
        ) : (
          <ul className="space-y-2">
            {roster.data
              .filter((row) => row.groupRole !== 'member')
              .map((row) => (
                <li
                  key={row.memberId}
                  className="flex flex-wrap items-center gap-x-2"
                >
                  <MemberName
                    memberId={row.memberId}
                    fullName={row.fullName}
                    nickname={row.nickname}
                    size="sm"
                  />
                  <span className="text-muted-foreground">
                    {row.groupRole === 'manager'
                      ? (group.manager_title ?? 'Coordonator')
                      : (row.positionTitle ?? 'Responsabil')}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-lg font-semibold">Evenimente viitoare</h2>
        {events.isPending ? (
          <p role="status">Se încarcă…</p>
        ) : events.isError ? (
          <p role="alert">Nu am putut încărca evenimentele.</p>
        ) : !events.data?.length ? (
          <p>Nu sunt evenimente viitoare.</p>
        ) : (
          <ul className="space-y-3">
            {events.data.map((event) => (
              <li key={event.id}>
                <Link to="/calendar" className="font-medium underline">
                  {event.title}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {event.starts_at &&
                    new Date(event.starts_at).toLocaleString('ro-RO', {
                      timeZone: 'Europe/Bucharest',
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  {event.location && ` · ${event.location}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
