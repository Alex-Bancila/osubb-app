import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import {
  BackLink,
  Page,
  PageHeader,
  Panel,
  tabClass,
  tabListClass,
  useActiveTabInView,
} from '../../components/layout';
import { PrivateGroupBadge } from '../../components/group/PrivateGroupBadge';
import { Badge } from '../../components/ui/badge';
import { useAuth } from '../../lib/auth';
import { useCapabilities } from '../../lib/capabilities';
import { CommandError } from '../../lib/command-reasons';
import { formatMemberCount } from '../../lib/format';
import { parsePositiveInt } from '../../lib/ids';
import { Loading } from '../../components/states';
import { minimumLevelText } from '../../lib/minimum-level';
import { useGroupApplications } from '../../queries/group-applications';
import { useRoles } from '../../queries/reference';
import {
  groupAuthority,
  useAdminGroups,
  useAppointableMembers,
  useGroupCommand,
  explicitRoster,
  useGroupRoster,
  useMyGroupRoles,
  type AdminGroup,
  type GroupAuthority,
  type GroupCommand,
} from '../../queries/groups-admin';
import { CampaignsPanel } from '../campaigns/CampaignsPanel';
import { GroupApplicationsTab } from './GroupApplicationsTab';
import { GroupChildrenTab } from './GroupChildrenTab';
import { GroupCreatedReceipt } from './GroupCreateDialog';
import { GroupRolesTab } from './GroupRolesTab';
import { GroupRosterTab } from './GroupRosterTab';
import { GroupSettingsTab } from './GroupSettingsTab';
import {
  categoryLabel,
  currentGroupTab,
  createdGroupManager,
  groupPathNames,
  groupStatusLabel,
  groupTabs,
} from './group-tree';

/** The query key that holds the open tab (navigation D6). */
const TAB_KEY = 'tab';

const SUCCESS: Record<GroupCommand['kind'], string> = {
  create: 'Grupul a fost creat.',
  settings: 'Setările au fost salvate.',
  structure: 'Structura grupului a fost salvată.',
  archive: 'Grupul a fost arhivat.',
  addMember: 'Membrul a fost adăugat în grup.',
  removeMember: 'Membrul a fost scos din grup.',
  setRole: 'Funcția a fost actualizată.',
};

function Breadcrumb({
  group,
  byId,
}: {
  group: AdminGroup;
  byId: ReadonlyMap<number, AdminGroup>;
}) {
  const names = groupPathNames(group, byId);
  if (names.length < 2) return null;
  return (
    <nav
      aria-label="Grupuri deasupra"
      className="text-sm text-muted-foreground"
    >
      {names.slice(0, -1).map((ancestor, index) => (
        <span key={ancestor.id}>
          {index > 0 && <span aria-hidden="true"> · </span>}
          <Link
            to={`/administrare/grupuri/${ancestor.id}`}
            className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {ancestor.name}
          </Link>
        </span>
      ))}
    </nav>
  );
}

/**
 * Back to the Grupuri tab this page sits under (#825) — or, when a member page
 * opened this one with `state.from`, back there (navigation D4).
 */
function BackToGroups() {
  return <BackLink to="/administrare/grupuri" label="Înapoi la Administrare" />;
}

/**
 * The Group's tabs as links to `?tab=<id>` (navigation D6): a notification,
 * the Cereri queue or a reload opens the tab the link names. Each link
 * replaces the history entry — switching tabs is not a page to go back to —
 * and carries the page's `state`, so a back link set by the member page
 * survives a tab change. One row at 375 px (#841's strip).
 */
function GroupTabs({
  tabs,
  active,
}: {
  tabs: readonly { id: string; label: string }[];
  active: string;
}) {
  const nav = useRef<HTMLElement>(null);
  const location = useLocation();
  useActiveTabInView(nav, active);
  return (
    <nav ref={nav} aria-label="Secțiunile grupului" className={tabListClass}>
      {tabs.map((item) => {
        const params = new URLSearchParams(location.search);
        params.set(TAB_KEY, item.id);
        return (
          <Link
            key={item.id}
            to={{ search: `?${params.toString()}` }}
            replace
            state={location.state}
            aria-current={item.id === active ? 'page' : undefined}
            className={tabClass}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

const EYEBROW = 'Administrare';

/**
 * An archived Group is read-only for everyone (Audit D-10): the server refuses
 * every change with `group_archived`, so the page offers none.
 */
const READ_ONLY: GroupAuthority = {
  manageWork: false,
  manageGroup: false,
  editStructure: false,
  appointManager: false,
  archive: false,
  editMinLevel: false,
};

/**
 * One Group, with everything its Managers decide about it: settings, roster,
 * positions, Child Groups and Campaigns. The same screen opens from the BC
 * tree and from a Manager's own list — one flow, one command set (ADR-0009
 * §Management surface).
 */
export default function GroupScreen() {
  const { groupId } = useParams();
  // A malformed id is no Group: 0 matches none, and no query is sent for it.
  const parsedId = parsePositiveInt(groupId);
  const id = parsedId ?? 0;
  const capabilities = useCapabilities();
  const groupsQuery = useAdminGroups();
  const myGroupsQuery = useMyGroupRoles();
  const rosterQuery = useGroupRoster(parsedId);
  const rolesQuery = useRoles();
  const membersQuery = useAppointableMembers();
  const command = useGroupCommand();
  const actorLevel = useAuth().claims?.member_level ?? 0;
  const [searchParams] = useSearchParams();
  const applicationsQuery = useGroupApplications(id);
  const [message, setMessage] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastReason, setLastReason] = useState<string | undefined>(undefined);
  const submitting = useRef(false);

  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const byId = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );
  const group = byId.get(id);
  const parent =
    group?.parent_id === null ? undefined : byId.get(group?.parent_id ?? -1);
  const children = useMemo(
    () =>
      groups
        .filter((row) => row.parent_id === id)
        .sort((left, right) => left.name.localeCompare(right.name, 'ro')),
    [groups, id],
  );
  // Every Group below this one, at any depth: what turning it private hides.
  const subtree = useMemo(
    () =>
      groups
        .filter((row) => row.id !== id && row.path.includes(id))
        .sort((left, right) => left.name.localeCompare(right.name, 'ro')),
    [groups, id],
  );
  const levels = useMemo(
    () => [
      ...new Set([...(rolesQuery.data?.values() ?? [])].map((r) => r.level)),
    ],
    [rolesQuery.data],
  );
  const createTopLevel = capabilities.data?.createTopLevelGroups === true;
  const archived = group !== undefined && group.status !== 'active';
  const authority = useMemo(
    () =>
      archived
        ? READ_ONLY
        : groupAuthority(
            group ?? { id, parent_id: null },
            myGroupsQuery.data,
            createTopLevel,
          ),
    [archived, group, id, myGroupsQuery.data, createTopLevel],
  );
  const tabs = groupTabs(authority, {
    hasChildren: children.length > 0,
    canCreateChild: authority.manageGroup && group?.status === 'active',
    acceptsApplications: group?.accepts_applications === true,
    pendingApplications: applicationsQuery.data?.length ?? 0,
  });
  const tab = currentGroupTab(searchParams.get(TAB_KEY), tabs);

  async function run(
    next: GroupCommand,
    onFailure?: (failure: unknown) => void,
  ): Promise<boolean> {
    if (submitting.current) return false;
    submitting.current = true;
    setError(null);
    setMessage(null);
    try {
      await command.mutateAsync(next);
      setLastReason(undefined);
      setMessage(
        next.kind === 'create' ? (
          <GroupCreatedReceipt
            manager={createdGroupManager(next, membersQuery.data ?? [])}
          />
        ) : (
          SUCCESS[next.kind]
        ),
      );
      return true;
    } catch (failure) {
      const known = failure instanceof CommandError;
      setLastReason(known ? failure.reason : undefined);
      if (onFailure) onFailure(failure);
      else
        setError(
          known ? failure.message : 'Nu am putut salva schimbarea. Reîncearcă.',
        );
      return false;
    } finally {
      submitting.current = false;
    }
  }

  if (
    parsedId !== null &&
    (groupsQuery.isPending ||
      myGroupsQuery.isPending === true ||
      capabilities.isPending === true)
  )
    return (
      <Page aria-label="Grup">
        <Loading label="Se încarcă grupul…" />
      </Page>
    );

  if (!group)
    return (
      <Page>
        <BackToGroups />
        <PageHeader eyebrow={EYEBROW} title="Grup" />
        <p role="alert">Nu ai acces la acest grup sau grupul nu există.</p>
      </Page>
    );

  const busy = command.isPending;
  // Every member (#929, ruling R32) for the Roster tab; the explicit rows alone
  // for Roluri and Setări, which act only on roster rows.
  const everyMember = rosterQuery.data ?? [];
  const roster = explicitRoster(everyMember);
  const activeLabel = tabs.find((item) => item.id === tab)?.label ?? '';

  return (
    <Page>
      <div className="-mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <BackToGroups />
        <Breadcrumb group={group} byId={byId} />
      </div>
      <PageHeader
        eyebrow={EYEBROW}
        title={
          <span className="inline-flex max-w-full min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="size-4 shrink-0 rounded-full"
              style={{ backgroundColor: group.color ?? 'var(--brand-red)' }}
            />
            <span className="min-w-0">{group.name}</span>
          </span>
        }
        badge={
          <>
            <Badge variant="outline">{categoryLabel(group.category)}</Badge>
            <PrivateGroupBadge isPrivate={group.is_private} />
            {group.status !== 'active' && (
              <Badge variant="secondary">
                {groupStatusLabel(group.status)}
              </Badge>
            )}
          </>
        }
        description={
          <>
            Nivel minim: {minimumLevelText(group.min_level)}
            {` · ${formatMemberCount(group.memberCount)}`}
            {group.automatic_membership && ', adăugați automat'}
          </>
        }
      />

      {/* The one refusal line (relevance B49): a viewer who can change
          nothing here is told once, not once per tab. */}
      {archived ? (
        <p className="m-0 -mt-3 text-sm text-muted-foreground">
          Grupul este arhivat; nu se mai poate modifica.
        </p>
      ) : (
        !authority.manageWork &&
        !authority.manageGroup &&
        !authority.appointManager && (
          <p className="m-0 -mt-3 text-sm text-muted-foreground">
            Vezi grupul, dar schimbările îi revin coordonatorului lui.
          </p>
        )
      )}

      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <GroupTabs tabs={tabs} active={tab} />

      <div role="region" aria-label={activeLabel} className="min-w-0">
        {tab === 'setari' && (
          <GroupSettingsTab
            // A new Group is a new draft: every field starts from its row.
            key={group.id}
            group={group}
            parent={parent}
            subtree={subtree}
            roster={roster}
            authority={authority}
            levels={levels}
            actorLevel={actorLevel}
            busy={busy}
            error={error}
            lastReason={lastReason}
            onRun={run}
          />
        )}
        {tab === 'roster' &&
          (rosterQuery.isPending ? (
            <Panel aria-label="Roster">
              <Loading label="Se încarcă membrii…" />
            </Panel>
          ) : (
            <GroupRosterTab
              group={group}
              roster={everyMember}
              members={membersQuery.data ?? []}
              authority={authority}
              busy={busy}
              error={error}
              onRun={run}
            />
          ))}
        {tab === 'roluri' &&
          (rosterQuery.isPending ? (
            <Panel aria-label="Roluri">
              <Loading label="Se încarcă funcțiile…" />
            </Panel>
          ) : (
            <GroupRolesTab
              group={group}
              roster={roster}
              members={membersQuery.data ?? []}
              authority={authority}
              busy={busy}
              error={error}
              onRun={run}
            />
          ))}
        {tab === 'copii' && (
          <GroupChildrenTab
            group={group}
            childGroups={children}
            members={membersQuery.data ?? []}
            levels={levels}
            actorLevel={actorLevel}
            authority={authority}
            authorityFor={(child) =>
              archived
                ? READ_ONLY
                : groupAuthority(child, myGroupsQuery.data, createTopLevel)
            }
            busy={busy}
            error={error}
            onRun={run}
          />
        )}
        {tab === 'campanii' && (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-sm text-muted-foreground">
              Raportul unei campanii arată punctele obținute și cine a lucrat.
            </p>
            <CampaignsPanel
              group={group}
              label={group.name}
              groups={groups}
              readOnly={archived}
            />
          </div>
        )}
        {tab === 'cereri' && (
          <Panel
            aria-label="Cereri"
            // #698 (ruling R18): with a form link, applicants go to the form
            // and join by Appointment. Applications filed before the link was
            // set still list below, to be decided.
            description={
              group.application_form_url
                ? 'Grupul primește înscrieri prin formular; adaugă membrii din Roster.'
                : undefined
            }
          >
            <GroupApplicationsTab
              groupId={id}
              canDecide={authority.manageWork}
            />
          </Panel>
        )}
      </div>
    </Page>
  );
}
