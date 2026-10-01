import { Link, useLocation, useParams } from 'react-router';
import { CalendarDays, Users } from 'lucide-react';
import { cn } from 'cn';
import {
  BackLink,
  EmptyState,
  ListRow,
  Page,
  PageGrid,
  PageHeader,
  Panel,
  backLinkState,
  rowListClass,
} from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { PrivateGroupBadge } from '../../components/group/PrivateGroupBadge';
import { Badge } from '../../components/ui/badge';
import { buttonVariants } from '../../components/ui/button';
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
import {
  categoryLabel,
  groupRoleLabel,
  groupStatusLabel,
} from '../administrare/group-tree';
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
  const location = useLocation();
  // `state.from` first (the page that opened this one); otherwise Grupuri,
  // which lists the member's own Groups (navigation D8, A33).
  const back = <BackLink to="/grupuri" label="Înapoi la Grupuri" />;
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
  // An archived Group, a Private Group the member has left, or an id that was
  // never a Group: a notification link can end here, so say why and lead on
  // (navigation D23).
  if (!group)
    return (
      <Page>
        {back}
        <PageHeader
          eyebrow="Grupuri"
          title="Grup indisponibil"
          description="Grupul a fost arhivat sau nu mai ai acces la el."
        />
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
  // The viewer's own title on their own row for that position (#962, #967);
  // a position held from a Group above has no row here, so the Group's name
  // for it applies.
  const roleTitle = role
    ? groupRoleLabel(
        role.group_role,
        group.manager_title,
        roster.data?.find(
          (row) =>
            row.memberId === auth.session?.user.id &&
            row.groupRole === role.group_role,
        )?.positionTitle,
        group.responsible_title,
      )
    : null;
  // Coordonare only when someone holds a position (relevance B29); while it
  // loads or fails the panel keeps its place.
  const coordinators =
    roster.data?.filter((row) => row.groupRole !== 'member') ?? [];
  const showCoordination =
    roster.isPending || roster.isError || coordinators.length > 0;
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
        eyebrow="Grupuri"
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
        badge={
          <>
            <PrivateGroupBadge isPrivate={group.is_private} />
            {/* As on the Administrare Group page (F-18). */}
            {group.status !== 'active' && (
              <Badge variant="secondary">
                {groupStatusLabel(group.status)}
              </Badge>
            )}
          </>
        }
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
                  className={cn(buttonVariants({ variant: 'outline' }))}
                  to={`/administrare/grupuri/${id}`}
                  // Its back link returns here, not to Administrare (D10).
                  state={backLinkState(location, `Înapoi la ${group.name}`)}
                >
                  Administrare
                </Link>
              )}
            </>
          )
        }
      />
      <PageGrid columns={showCoordination ? 2 : 1} alignHeaders>
        {showCoordination && (
          <Panel eyebrow="Grup" icon={Users} title="Coordonare" flush>
            {roster.isPending ? (
              <Loading />
            ) : roster.isError ? (
              <ErrorState text="Nu am putut încărca funcțiile din grup." />
            ) : (
              <ul className={rowListClass}>
                {coordinators.map((row) => (
                  <ListRow
                    key={row.memberId}
                    value={
                      // A long title wraps rather than cutting the name
                      // short, at every width the panel is narrow (F-4).
                      <span className="block max-w-28 text-sm whitespace-normal text-muted-foreground sm:max-w-40 xl:max-w-56">
                        {groupRoleLabel(
                          row.groupRole,
                          group.manager_title,
                          row.positionTitle,
                          group.responsible_title,
                        )}
                      </span>
                    }
                  >
                    <MemberName
                      memberId={row.memberId}
                      fullName={row.fullName}
                      nickname={row.nickname}
                      size="sm"
                    />
                  </ListRow>
                ))}
              </ul>
            )}
          </Panel>
        )}
        <Panel
          eyebrow="Calendar"
          icon={CalendarDays}
          title="Evenimente viitoare"
          flush={Boolean(events.data?.length)}
        >
          {events.isPending ? (
            <Loading />
          ) : events.isError ? (
            <ErrorState text="Nu am putut încărca evenimentele." />
          ) : !events.data?.length ? (
            <EmptyState>Nu sunt evenimente viitoare.</EmptyState>
          ) : (
            <ul className={rowListClass}>
              {events.data.map((event) => (
                <ListRow key={event.id} className="relative">
                  <Link
                    // The Calendar opens on this Event (navigation D5).
                    to={`/calendar?event=${event.id}`}
                    className={cn(
                      'block font-semibold text-foreground underline-offset-4 after:absolute after:inset-0 after:rounded-sm hover:underline',
                      'outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-ring focus-visible:after:outline-solid',
                    )}
                  >
                    {event.title}
                  </Link>
                  <p className="m-0 text-sm text-muted-foreground">
                    {event.starts_at &&
                      new Date(event.starts_at).toLocaleString('ro-RO', {
                        timeZone: 'Europe/Bucharest',
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    {event.location && ` · ${event.location}`}
                  </p>
                </ListRow>
              ))}
            </ul>
          )}
        </Panel>
      </PageGrid>
    </Page>
  );
}
