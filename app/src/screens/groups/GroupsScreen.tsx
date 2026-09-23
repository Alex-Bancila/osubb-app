import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/badge';
import { useAuth } from '../../lib/auth';
import { useAdminGroups, useMyGroupRoles } from '../../queries/groups-admin';
import { useGroupApplications } from '../../queries/group-applications';
import { categoryLabel } from '../administrare/group-tree';
import { ApplicationAction } from './ApplicationAction';
import { acceptsApplication } from './application-eligibility';

export default function GroupsScreen() {
  const groups = useAdminGroups();
  const mine = useMyGroupRoles();
  const applications = useGroupApplications();
  const level = useAuth().claims?.member_level ?? 0;
  const [search, setSearch] = useState('');
  if (groups.isPending || mine.isPending || applications.isPending)
    return <p role="status">Se încarcă grupurile…</p>;
  if (groups.isError || mine.isError || applications.isError)
    return <p role="alert">Nu am putut încărca grupurile. Reîncarcă pagina.</p>;
  const available = groups.data.filter((group) =>
    acceptsApplication(group, level),
  );
  const visible = available.filter((group) =>
    group.name.toLocaleLowerCase('ro').includes(search.toLocaleLowerCase('ro')),
  );
  return (
    <section className="page space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Grupuri</h1>
        <p className="mt-2 text-muted-foreground">
          Descoperă grupurile în care te poți implica.
        </p>
      </header>
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
        <p role="status">Nu sunt grupuri disponibile pentru această căutare.</p>
      )}
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((group) => {
          const pending = applications.data.find(
            (row) => row.group_id === group.id,
          );
          const membership = mine.data.find(
            (row) => row.id === group.id && (row.explicit || row.automatic),
          );
          const ancestor = groups.data.find(
            (row) => row.id === group.path[0] && row.id !== group.id,
          );
          return (
            <li
              key={group.id}
              className="space-y-4 rounded-xl border bg-card p-5"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1 h-4 w-4 shrink-0 rounded-full"
                  style={{ backgroundColor: group.color ?? '#5C5C61' }}
                />
                <div>
                  <Link
                    className="text-lg font-semibold underline-offset-4 hover:underline"
                    to={`/grupuri/${group.id}`}
                  >
                    {group.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {categoryLabel(group.category)}
                    {ancestor ? ` · ${ancestor.name}` : ''}
                  </p>
                </div>
              </div>
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
              ) : (
                <ApplicationAction
                  label="Aplică"
                  command={{ kind: 'apply', groupId: group.id, note: '' }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
