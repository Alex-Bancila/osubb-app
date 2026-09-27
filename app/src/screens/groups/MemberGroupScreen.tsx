import { Link, useParams } from 'react-router';
import { CalendarDays, Users } from 'lucide-react';
import {
  EmptyState,
  Page,
  PageGrid,
  PageHeader,
  Panel,
} from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { PrivateGroupBadge } from '../../components/group/PrivateGroupBadge';
import { Badge } from '../../components/ui/badge';
import { useAuth } from '../../lib/auth';
import { useCapabilities } from '../../lib/capabilities';
import { parsePositiveInt } from '../../lib/ids';
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
  // A malformed id is no Group: 0 matches none, and the queries skip it.
  const id = parsePositiveInt(useParams().groupId) ?? 0;
  const groups = useAdminGroups();
  const mine = useMyGroupRoles();
  const applications = useGroupApplications();
  const roster = useGroupCoordination(id);
  const events = useGroupUpcomingEvents(id);
  const capabilities = useCapabilities();
  const auth = useAuth();
  const level = auth.claims?.member_level ?? 0;
  const back = (
    <Link
      to="/grupuri"
      className="inline-flex min-h-11 items-center rounded-sm underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      Înapoi la grupuri
    </Link>
  );
  if (groups.isPending || mine.isPending || applications.isPending)
    return (
      <Page aria-label="Grup">
        <Loading label="Se încarcă grupul…" />
      </Page>
    );
  if (groups.isError || mine.isError || applications.isError)
    return (
      <Page aria-label="Grup">
        <ErrorState text="Nu am putut încărca grupul. Reîncarcă pagina." />
      </Page>
    );
  const group = groups.data.find((row) => row.id === id);
  if (!group)
    return (
      <Page>
        <PageHeader title="Grup indisponibil" />
        {back}
      </Page>
    );
  const role = mine.data.find((row) => row.id === id);
  const pending = applications.data.find((row) => row.group_id === id);
  const form = applicationForm(group);
  const authority = groupAuthority(
    group,
    mine.data,
    capabilities.data?.createTopLevelGroups === true,
  );
  const roleTitle = role
    ? role.group_role === 'manager'
      ? (group.manager_title ?? 'Coordonator')
      : role.group_role === 'responsible'
        ? (roster.data?.find((row) => row.memberId === auth.session?.user.id)
            ?.positionTitle ?? 'Responsabil')
        : 'Membru'
    : null;
  const apply = pending ? (
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
  );
  return (
    <Page>
      {back}
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span
              aria-hidden="true"
              className="size-5 shrink-0 rounded-full"
              style={{ backgroundColor: group.color ?? '#5C5C61' }}
            />
            {group.name}
          </span>
        }
        badge={<PrivateGroupBadge isPrivate={group.is_private} />}
        description={
          <>
            {categoryLabel(group.category)}
            {roleTitle && (
              <span className="mt-1 block text-foreground">
                Rolul tău: <strong>{roleTitle}</strong>
              </span>
            )}
          </>
        }
        actions={
          (apply || authority.manageWork) && (
            <>
              {apply}
              {authority.manageWork && (
                <Link
                  className="inline-flex min-h-11 items-center rounded-sm underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  to={`/administrare/grupuri/${id}`}
                >
                  Administrare
                </Link>
              )}
            </>
          )
        }
      />
      <PageGrid columns={2}>
        <Panel eyebrow="Grup" icon={Users} title="Coordonare">
          {roster.isPending ? (
            <Loading />
          ) : roster.isError ? (
            <ErrorState text="Nu am putut încărca funcțiile din grup." />
          ) : !roster.data.some((row) => row.groupRole !== 'member') ? (
            <EmptyState>
              Nu sunt numite funcții de coordonare în acest grup.
            </EmptyState>
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
        </Panel>
        <Panel
          eyebrow="Calendar"
          icon={CalendarDays}
          title="Evenimente viitoare"
        >
          {events.isPending ? (
            <Loading />
          ) : events.isError ? (
            <ErrorState text="Nu am putut încărca evenimentele." />
          ) : !events.data?.length ? (
            <EmptyState>Nu sunt evenimente viitoare.</EmptyState>
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
        </Panel>
      </PageGrid>
    </Page>
  );
}
