import { useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { cn } from 'cn';
import {
  EmptyState,
  ListRow,
  Panel,
  SectionHeader,
  focusRingInsetClass,
  rowListClass,
} from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { ErrorState, Loading } from '../../components/states';
import { useCapabilities } from '../../lib/capabilities';
import {
  useManagedGroupApplications,
  type ManagedGroupApplication,
} from '../../queries/group-applications';
import { useAdminGroups, useMyGroupRoles } from '../../queries/groups-admin';
import { useMyGroups } from '../../queries/reference';
import { ApplicationAction } from '../groups/ApplicationAction';
import {
  applicationCount,
  applicationGroups,
  type ApplicationGroup,
} from './applications-tab';

/** A Group without a colour of its own reads as neutral, not as OSUBB red. */
const NO_COLOR = 'var(--ink-400)';

/**
 * Administrare → Cereri de aderare (#825, #922): the pending Group
 * Applications the viewer may decide, grouped by Group — the Group heads each
 * section, so no row repeats it in small print. Beside them (above them on a
 * phone) the viewer's Groups: every Group they lead as Manager or Responsabil,
 * here or inherited, with their role and pending count (0 too); for BC and the
 * Moderator also every Group with a pending Application. Choosing one
 * (`?grup=<id>`) shows only its Applications; "Toate" shows every section.
 * Each Application is decided in place with the same command as the Group
 * page's Cereri tab. Completed-work Requests keep their own page (`/cereri`).
 */
export default function AdminApplicationsTab() {
  const applications = useManagedGroupApplications();
  const myGroups = useMyGroupRoles();
  const groups = useAdminGroups();
  const rosterRows = useMyGroups().membershipRows;
  const decidesEverywhere = useCapabilities(
    (capabilities) => capabilities.createTopLevelGroups,
  ).data;
  const [params] = useSearchParams();
  const [decided, setDecided] = useState(false);

  const list = useMemo(
    () =>
      applications.data
        ? applicationGroups({
            applications: applications.data,
            // A failed Group read still lists every Group with a request.
            myGroups: myGroups.data ?? [],
            groups: groups.data ?? [],
            rosterRows,
          })
        : [],
    [applications.data, myGroups.data, groups.data, rosterRows],
  );
  const byGroup = useMemo(() => {
    const rows = new Map<number, ManagedGroupApplication[]>();
    for (const row of applications.data ?? [])
      rows.set(row.group_id, [...(rows.get(row.group_id) ?? []), row]);
    return rows;
  }, [applications.data]);

  if (applications.isPending || myGroups.isPending || groups.isPending)
    return <Loading label="Se încarcă cererile…" />;
  if (applications.isError)
    return (
      <ErrorState
        text="Nu am putut încărca cererile."
        onRetry={() => void applications.refetch()}
      />
    );

  const asked = Number(params.get('grup'));
  // One Group is its own "all"; an unknown `?grup=` shows every section.
  const selected =
    list.find((group) => group.id === asked) ??
    (list.length === 1 ? list[0] : undefined);
  const sections = selected
    ? [selected]
    : list.filter((group) => group.pending > 0);
  // A single Group needs no list: its section already names it, with the
  // viewer's role and its count.
  const showList = list.length > 1;

  return (
    <div
      className={cn(
        'grid min-w-0 gap-4 md:items-start md:gap-6',
        showList && 'md:grid-cols-[17rem_minmax(0,1fr)]',
      )}
    >
      {showList && (
        <GroupList
          title={decidesEverywhere ? 'Grupuri' : 'Grupurile tale'}
          groups={list}
          selectedId={selected?.id ?? null}
          total={applications.data.length}
        />
      )}
      <div className="flex min-w-0 flex-col gap-6">
        {decided && (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            Cererea a fost actualizată.
          </p>
        )}
        {sections.length === 0 ? (
          <Panel title="Cereri de aderare">
            <EmptyState icon={Inbox}>
              Nicio cerere de aderare în așteptare.
            </EmptyState>
          </Panel>
        ) : (
          sections.map((group) => (
            <GroupApplications
              key={group.id}
              group={group}
              rows={byGroup.get(group.id) ?? []}
              onDecided={() => setDecided(true)}
              withMeta={!showList}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** The Group's colour mark; the name beside it always says the same. */
function GroupSwatch({
  color,
  className,
}: {
  color: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-slot="group-swatch"
      className={cn('shrink-0 rounded-[4px]', className)}
      style={{ backgroundColor: color ?? NO_COLOR }}
    />
  );
}

/** "Responsabil", or "Coordonator · din grupul de deasupra" when inherited. */
function roleText(group: ApplicationGroup): string | null {
  if (!group.roleLabel) return null;
  return group.inherited
    ? `${group.roleLabel} · din grupul de deasupra`
    : group.roleLabel;
}

/** "Echipa IT · Diverse": the parent, muted, after a subgroup's name. */
function GroupName({ group }: { group: ApplicationGroup }) {
  return (
    <>
      {group.name}
      {group.parentName && (
        <>
          {' '}
          <span className="font-normal text-muted-foreground">
            · {group.parentName}
          </span>
        </>
      )}
    </>
  );
}

function CountPill({ count }: { count: number }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-2 text-xs font-bold tabular-nums',
        count > 0
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground',
      )}
    >
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{applicationCount(count)}</span>
    </span>
  );
}

/**
 * The viewer's Groups: a column beside the requests from `md`; on a phone a
 * row of cards that scrolls sideways inside itself (the page never does).
 * Each card links to `?grup=<id>`; "Toate" clears it.
 */
function GroupList({
  title,
  groups,
  selectedId,
  total,
}: {
  title: string;
  groups: readonly ApplicationGroup[];
  selectedId: number | null;
  total: number;
}) {
  const itemClass = cn(
    'flex min-h-11 min-w-0 items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-foreground no-underline',
    'md:w-full md:rounded-none md:border-0 md:bg-transparent md:px-4 md:py-3',
    'hover:bg-accent aria-[current=page]:border-primary aria-[current=page]:bg-primary/10',
    'md:aria-[current=page]:shadow-[inset_3px_0_0_var(--primary)]',
    focusRingInsetClass,
  );
  return (
    <nav aria-label={title} className="min-w-0">
      <SectionHeader title={title} />
      <ul
        className={cn(
          'm-0 flex list-none gap-2 overflow-x-auto p-0 pb-1',
          'md:flex-col md:gap-0 md:overflow-hidden md:rounded-md md:border md:border-border md:bg-card md:pb-0 md:shadow-(--sh-sm)',
          'md:divide-y md:divide-(--border-soft)',
        )}
      >
        <li className="flex shrink-0 md:shrink">
          <Link
            to="?"
            aria-current={selectedId === null ? 'page' : undefined}
            className={itemClass}
          >
            <span className="min-w-0 flex-1 text-sm font-semibold">Toate</span>
            <CountPill count={total} />
          </Link>
        </li>
        {groups.map((group) => (
          <li
            key={group.id}
            className="flex w-[13.5rem] min-w-0 shrink-0 md:w-auto md:shrink"
          >
            <Link
              to={`?grup=${group.id}`}
              aria-current={selectedId === group.id ? 'page' : undefined}
              className={cn(itemClass, 'w-full')}
            >
              <GroupSwatch color={group.color} className="size-3" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold break-words">
                  <GroupName group={group} />
                </span>
                {group.roleLabel && (
                  <span className="text-xs text-muted-foreground">
                    {roleText(group)}
                  </span>
                )}
              </span>
              <CountPill count={group.pending} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One Group's pending Applications, headed by the Group itself. */
function GroupApplications({
  group,
  rows,
  onDecided,
  withMeta,
}: {
  group: ApplicationGroup;
  rows: readonly ManagedGroupApplication[];
  onDecided: () => void;
  /** Role and count under the name, when no Group list carries them. */
  withMeta: boolean;
}) {
  return (
    <Panel
      flush={rows.length > 0}
      title={
        <span className="inline-flex max-w-full items-center gap-2.5">
          <GroupSwatch color={group.color} className="size-4" />
          <span className="min-w-0 break-words">
            <GroupName group={group} />
          </span>
        </span>
      }
      description={
        withMeta
          ? [roleText(group), applicationCount(group.pending)]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      action={{
        label: 'Deschide grupul',
        // Straight to the Group's Cereri tab (navigation D6).
        to: `/administrare/grupuri/${group.id}?tab=cereri`,
      }}
    >
      {rows.length === 0 ? (
        <EmptyState icon={Inbox}>
          Nicio cerere în așteptare pentru acest grup.
        </EmptyState>
      ) : (
        <ul
          className={rowListClass}
          aria-label={`Cereri de aderare · ${group.name}`}
        >
          {rows.map((row) => (
            <ListRow
              key={row.id}
              stackAction
              action={
                <>
                  <ApplicationAction
                    label="Acceptă"
                    onSuccess={onDecided}
                    command={{
                      kind: 'decide',
                      applicationId: row.id,
                      accept: true,
                      note: '',
                    }}
                  />
                  <ApplicationAction
                    label="Respinge"
                    onSuccess={onDecided}
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
                <time dateTime={row.created_at}>
                  {new Date(row.created_at).toLocaleDateString('ro-RO')}
                </time>
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
