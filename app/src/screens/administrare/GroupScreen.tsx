import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { cn } from 'cn';
import { PrivateGroupBadge } from '../../components/group/PrivateGroupBadge';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { useCapabilities } from '../../lib/capabilities';
import { CommandError } from '../../lib/command-reasons';
import { useRoles } from '../../queries/reference';
import {
  groupAuthority,
  useAdminGroups,
  useAppointableMembers,
  useGroupCommand,
  useGroupRoster,
  useMyGroupRoles,
  type AdminGroup,
  type GroupCommand,
} from '../../queries/groups-admin';
import { CampaignsPanel } from '../campaigns/CampaignsPanel';
import { GroupApplicationsTab } from './GroupApplicationsTab';
import { GroupChildrenTab } from './GroupChildrenTab';
import { GroupRolesTab } from './GroupRolesTab';
import { GroupRosterTab } from './GroupRosterTab';
import { GroupSettingsTab } from './GroupSettingsTab';
import { categoryLabel, groupPathNames, groupStatusLabel } from './group-tree';

const TABS = [
  { id: 'setari', label: 'Setări' },
  { id: 'roster', label: 'Roster' },
  { id: 'roluri', label: 'Roluri' },
  { id: 'copii', label: 'Grupuri copil' },
  { id: 'campanii', label: 'Campanii' },
  { id: 'cereri', label: 'Cereri' },
] as const;

type TabId = (typeof TABS)[number]['id'];

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
 * One Group, with everything its Managers decide about it: settings, roster,
 * positions, Child Groups and Campaigns. The same screen opens from the BC
 * tree and from a Manager's own list — one flow, one command set (ADR-0009
 * §Management surface).
 */
export default function GroupScreen() {
  const { groupId } = useParams();
  const id = Number(groupId);
  const capabilities = useCapabilities();
  const groupsQuery = useAdminGroups();
  const myGroupsQuery = useMyGroupRoles();
  const rosterQuery = useGroupRoster(Number.isFinite(id) ? id : null);
  const rolesQuery = useRoles();
  const membersQuery = useAppointableMembers();
  const command = useGroupCommand();
  const actorLevel = useAuth().claims?.member_level ?? 0;
  const [tab, setTab] = useState<TabId>('setari');
  const [message, setMessage] = useState<string | null>(null);
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
  const authority = useMemo(
    () =>
      groupAuthority(
        group ?? { id, parent_id: null },
        myGroupsQuery.data,
        createTopLevel,
      ),
    [group, id, myGroupsQuery.data, createTopLevel],
  );

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
      setMessage(SUCCESS[next.kind]);
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

  if (groupsQuery.isPending)
    return (
      <section className="p-4 md:p-6">
        <p role="status">Se încarcă grupul…</p>
      </section>
    );

  if (!group)
    return (
      <section className="space-y-3 p-4 md:p-6">
        <h1 className="text-2xl font-bold">Grup</h1>
        <p role="alert">Nu ai acces la acest grup sau grupul nu există.</p>
        <Link
          to="/administrare"
          className="inline-flex min-h-11 items-center underline"
        >
          Înapoi la Administrare
        </Link>
      </section>
    );

  const busy = command.isPending;
  const roster = rosterQuery.data ?? [];

  return (
    <section
      className="min-w-0 space-y-5 p-4 md:p-6"
      aria-labelledby="group-title"
    >
      <header className="space-y-2">
        <Breadcrumb group={group} byId={byId} />
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 rounded-full"
            style={{ backgroundColor: group.color ?? 'var(--brand-red)' }}
          />
          <h1 id="group-title" className="text-2xl font-bold">
            {group.name}
          </h1>
          <Badge variant="outline">{categoryLabel(group.category)}</Badge>
          <PrivateGroupBadge isPrivate={group.is_private} />
          {group.status !== 'active' && (
            <Badge variant="secondary">{groupStatusLabel(group.status)}</Badge>
          )}
        </div>
        <p className="text-muted-foreground">
          Nivel minim {group.min_level}
          {group.automatic_membership
            ? ' · membri adăugați automat'
            : ` · ${group.memberCount} membri`}
        </p>
      </header>

      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <div
        role="tablist"
        aria-label="Secțiunile grupului"
        className="flex flex-wrap gap-1 border-b"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={cn(
              'min-h-11 rounded-t-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring',
              tab === item.id
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
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
            <p role="status">Se încarcă membrii…</p>
          ) : (
            <GroupRosterTab
              group={group}
              roster={roster}
              members={membersQuery.data ?? []}
              authority={authority}
              busy={busy}
              error={error}
              onRun={run}
            />
          ))}
        {tab === 'roluri' &&
          (rosterQuery.isPending ? (
            <p role="status">Se încarcă funcțiile…</p>
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
              groupAuthority(child, myGroupsQuery.data, createTopLevel)
            }
            busy={busy}
            error={error}
            onRun={run}
          />
        )}
        {tab === 'campanii' && (
          <div className="space-y-4">
            <p className="text-muted-foreground">
              O campanie este o etichetă pentru taskurile grupului și ale
              subgrupurilor lui. Raportul ei arată punctele obținute și cine a
              lucrat.
            </p>
            <CampaignsPanel group={group} label={group.name} groups={groups} />
          </div>
        )}
        {tab === 'cereri' && (
          <div className="space-y-4">
            {/* #698 (ruling R18): with a form link, applicants go to the form
                and join by Appointment. Applications filed before the link
                was set still list below, to be decided. */}
            {group.application_form_url && (
              <p className="text-muted-foreground">
                Grupul primește înscrieri prin formular; adaugă membrii din
                Roster.
              </p>
            )}
            <GroupApplicationsTab
              groupId={id}
              canDecide={authority.manageWork}
            />
          </div>
        )}
      </div>

      {!authority.manageWork && !authority.manageGroup && (
        <p className="text-sm text-muted-foreground">
          Vezi grupul, dar schimbările îi revin coordonatorului lui.
        </p>
      )}

      <Button
        variant="outline"
        render={<Link to="/administrare">Înapoi la Administrare</Link>}
      />
    </section>
  );
}
