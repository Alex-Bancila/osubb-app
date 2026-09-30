import { useState } from 'react';
import { Link } from 'react-router';
import {
  EmptyState,
  ListRow,
  Page,
  PageGrid,
  PageHeader,
  Panel,
  Section,
  rowListClass,
} from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { useAuth } from '../../lib/auth';
import {
  useAdminGroups,
  useMyGroupRoles,
  type AdminGroup,
} from '../../queries/groups-admin';
import { useGroupApplications } from '../../queries/group-applications';
import { isMemberOf, type MyGroup } from '../../queries/my-groups';
import { useMyGroups } from '../../queries/reference';
import {
  categoryLabel,
  groupRoleLabel,
  inheritsGroupRole,
} from '../administrare/group-tree';
import { ApplicationAction } from './ApplicationAction';
import { ApplicationFormLink } from './ApplicationFormLink';
import { acceptsApplication, applicationForm } from './application-eligibility';

/**
 * Grupuri (#852): the member's own Groups first, so every Group page's back
 * link lands on a list that contains it (navigation D8), then the Groups that
 * accept their Application. With nothing to apply to, the page says so and
 * offers no search box (relevance B28, Audit D D-18).
 */
export default function GroupsScreen() {
  const groups = useAdminGroups();
  const mine = useMyGroupRoles();
  // Only for a Group Responsible's display name: `my_groups()` carries none.
  const rosterRows = useMyGroups();
  const applications = useGroupApplications();
  const level = useAuth().claims?.member_level ?? 0;
  const [search, setSearch] = useState('');
  const header = (
    <PageHeader
      title="Grupuri"
      description="Grupurile din care faci parte și cele la care poți aplica."
    />
  );
  if (
    groups.isPending ||
    mine.isPending ||
    applications.isPending ||
    rosterRows.isPending
  )
    return (
      <Page>
        {header}
        <Loading label="Se încarcă grupurile…" />
      </Page>
    );
  if (
    groups.isError ||
    mine.isError ||
    applications.isError ||
    rosterRows.isError
  )
    return (
      <Page>
        {header}
        <ErrorState text="Nu am putut încărca grupurile. Reîncarcă pagina." />
      </Page>
    );
  const readable = new Map(groups.data.map((group) => [group.id, group]));
  // Membership, not authority (ruling R31): a Group reached only through a
  // managed ancestor is not one of "your" Groups. The Organization Group holds
  // everyone and says nothing (ruling R16); an archived Group has no page.
  const own = mine.data
    .flatMap((row) => {
      const group = readable.get(row.id);
      return group &&
        isMemberOf(row) &&
        !row.is_organization &&
        row.status === 'active'
        ? [{ row, group }]
        : [];
    })
    .sort((a, b) => a.group.name.localeCompare(b.group.name, 'ro'));
  const ownIds = new Set(own.map(({ group }) => group.id));
  // Ruling R25: a Private Group is never offered here, even to a Member who
  // can read it (acceptsApplication skips is_private rows).
  const available = groups.data.filter(
    (group) => acceptsApplication(group, level) && !ownIds.has(group.id),
  );
  const query = search.trim().toLocaleLowerCase('ro');
  const visible = available.filter((group) =>
    group.name.toLocaleLowerCase('ro').includes(query),
  );
  const positionTitle = (groupId: number) =>
    rosterRows.membershipRows?.find((row) => row.group_id === groupId)
      ?.position_title;
  return (
    <Page>
      {header}
      <Section>
        <Panel title="Grupurile tale" flush={own.length > 0}>
          {own.length ? (
            <ul className={rowListClass}>
              {own.map(({ row, group }) => (
                <OwnGroupRow
                  key={group.id}
                  row={row}
                  group={group}
                  positionTitle={positionTitle(group.id)}
                  inherited={inheritsGroupRole(row, rosterRows.membershipRows)}
                />
              ))}
            </ul>
          ) : (
            <EmptyState>Nu faci parte încă din niciun grup.</EmptyState>
          )}
        </Panel>
      </Section>
      <Section title="Poți aplica la">
        {!available.length ? (
          <EmptyState bare>
            Niciun grup nu primește acum cereri de înscriere.
          </EmptyState>
        ) : (
          <>
            {/* One Group needs no search: there is nothing to narrow. */}
            {available.length > 1 && (
              <label className="grid max-w-lg gap-2">
                Caută un grup
                <input
                  className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Numele grupului"
                />
              </label>
            )}
            {visible.length ? (
              <PageGrid as="ul" columns="collection" equalHeights>
                {visible.map((group) => (
                  <li key={group.id}>
                    <ApplyPanel
                      group={group}
                      groups={groups.data}
                      pendingId={
                        applications.data.find(
                          (row) => row.group_id === group.id,
                        )?.id
                      }
                    />
                  </li>
                ))}
              </PageGrid>
            ) : (
              <EmptyState bare role="status">
                Nu sunt grupuri disponibile pentru această căutare.
              </EmptyState>
            )}
          </>
        )}
      </Section>
    </Page>
  );
}

/** One of the member's Groups: its page, its Category, their Group Role. */
function OwnGroupRow({
  row,
  group,
  positionTitle,
  inherited,
}: {
  row: MyGroup;
  group: AdminGroup;
  positionTitle: string | null | undefined;
  /** The position comes from a Group above, not from this roster (F-17). */
  inherited: boolean;
}) {
  // Ordinary membership is what the section already says; only a position
  // held here (Coordonator, a Responsible's display name) earns a label. One
  // inherited from above belongs to that Group's row, not this one.
  const role =
    !inherited &&
    (row.group_role === 'manager' || row.group_role === 'responsible')
      ? groupRoleLabel(
          row.group_role,
          group.manager_title,
          positionTitle,
          group.responsible_title,
        )
      : null;
  return (
    <ListRow
      className="relative"
      leading={
        <span
          aria-hidden="true"
          className="size-3 rounded-full"
          style={{ backgroundColor: group.color ?? '#5C5C61' }}
        />
      }
    >
      <Link
        to={`/grupuri/${row.id}`}
        // The whole row opens the Group; the ring is drawn round the row.
        className="block font-semibold text-foreground underline-offset-4 outline-none after:absolute after:inset-0 after:rounded-sm hover:underline focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-ring focus-visible:after:outline-solid"
      >
        {group.name}
      </Link>
      {/* The position rides on the meta line, not in a value column: a
          badge beside the name would squeeze it to one word at 375 px. */}
      <p className="m-0 text-sm text-muted-foreground">
        {categoryLabel(group.category)}
        {role && (
          <>
            {' · '}
            <span className="font-medium text-foreground">{role}</span>
          </>
        )}
      </p>
    </ListRow>
  );
}

/** A Group the member may apply to, with the one action that fits. */
function ApplyPanel({
  group,
  groups,
  pendingId,
}: {
  group: AdminGroup;
  groups: AdminGroup[];
  pendingId: number | undefined;
}) {
  const form = applicationForm(group);
  // The topmost ancestor the Member can read (the root, unless hidden).
  const ancestorId = group.path.find(
    (id) => id !== group.id && groups.some((other) => other.id === id),
  );
  const ancestor = groups.find((row) => row.id === ancestorId);
  return (
    <Panel
      level={3}
      eyebrow={`${categoryLabel(group.category)}${ancestor ? ` · ${ancestor.name}` : ''}`}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: group.color ?? '#5C5C61' }}
          />
          <Link
            className="min-w-0 underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring"
            to={`/grupuri/${group.id}`}
          >
            {group.name}
          </Link>
        </span>
      }
      boxClassName="flex flex-col items-start justify-center"
    >
      {pendingId ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary">Cerere în așteptare</Badge>
          <ApplicationAction
            label="Retrage aplicația"
            command={{ kind: 'withdraw', applicationId: pendingId }}
          />
        </div>
      ) : form ? (
        <ApplicationFormLink label={form.label} url={form.url} />
      ) : (
        <ApplicationAction
          label="Aplică"
          command={{ kind: 'apply', groupId: group.id, note: '' }}
        />
      )}
    </Panel>
  );
}
