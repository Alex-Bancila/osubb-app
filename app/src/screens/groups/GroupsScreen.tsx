import { useState } from 'react';
import { Link } from 'react-router';
import {
  EmptyState,
  Page,
  PageGrid,
  PageHeader,
  Panel,
} from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { useAuth } from '../../lib/auth';
import { useAdminGroups, useMyGroupRoles } from '../../queries/groups-admin';
import { useGroupApplications } from '../../queries/group-applications';
import { categoryLabel } from '../administrare/group-tree';
import { ApplicationAction } from './ApplicationAction';
import { ApplicationFormLink } from './ApplicationFormLink';
import { acceptsApplication, applicationForm } from './application-eligibility';

export default function GroupsScreen() {
  const groups = useAdminGroups();
  const mine = useMyGroupRoles();
  const applications = useGroupApplications();
  const level = useAuth().claims?.member_level ?? 0;
  const [search, setSearch] = useState('');
  const header = (
    <PageHeader
      title="Grupuri"
      description="Descoperă grupurile în care te poți implica."
    />
  );
  if (groups.isPending || mine.isPending || applications.isPending)
    return (
      <Page>
        {header}
        <Loading label="Se încarcă grupurile…" />
      </Page>
    );
  if (groups.isError || mine.isError || applications.isError)
    return (
      <Page>
        {header}
        <ErrorState text="Nu am putut încărca grupurile. Reîncarcă pagina." />
      </Page>
    );
  // Ruling R25: a Private Group is never offered here, even to a Member who
  // can read it (acceptsApplication skips is_private rows).
  const available = groups.data.filter((group) =>
    acceptsApplication(group, level),
  );
  const visible = available.filter((group) =>
    group.name.toLocaleLowerCase('ro').includes(search.toLocaleLowerCase('ro')),
  );
  return (
    <Page>
      {header}
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
      {!visible.length && (
        <EmptyState bare role="status">
          Nu sunt grupuri disponibile pentru această căutare.
        </EmptyState>
      )}
      <PageGrid as="ul" columns="collection">
        {visible.map((group) => {
          const pending = applications.data.find(
            (row) => row.group_id === group.id,
          );
          const membership = mine.data.find(
            (row) => row.id === group.id && (row.explicit || row.automatic),
          );
          const form = applicationForm(group);
          const ancestor = groups.data.find(
            // The topmost ancestor the Member can read (the root, unless hidden).
            (row) =>
              row.id ===
              group.path.find(
                (id) =>
                  id !== group.id &&
                  groups.data.some((other) => other.id === id),
              ),
          );
          return (
            <li key={group.id}>
              <Panel
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
                {membership ? (
                  <Badge variant="secondary">Ești membru</Badge>
                ) : pending ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="secondary">Cerere în așteptare</Badge>
                    <ApplicationAction
                      label="Retrage aplicația"
                      command={{ kind: 'withdraw', applicationId: pending.id }}
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
            </li>
          );
        })}
      </PageGrid>
    </Page>
  );
}
