import { useState } from 'react';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import { Button } from '../../components/ui/button';
import {
  useMemberDirectory,
  type DirectoryMember,
} from '../../queries/member-directory';

const baseColumns: DataTableColumn<DirectoryMember>[] = [
  { accessorKey: 'name', header: 'Nume' },
  { accessorKey: 'role', header: 'Rol' },
  {
    id: 'departments',
    accessorFn: (row) => row.departments.join(', ') || '—',
    header: 'Departamente',
  },
  {
    id: 'teams',
    accessorFn: (row) => row.teams.join(', ') || '—',
    header: 'Echipe',
  },
  { accessorKey: 'points', header: 'Puncte din taskuri' },
  {
    id: 'status',
    accessorFn: (row) =>
      ({ activ: 'Activ', inactiv: 'Inactiv', alumni: 'Alumni' })[row.status] ??
      row.status,
    header: 'Statut',
  },
];
const contactColumns: DataTableColumn<DirectoryMember>[] = [
  {
    id: 'email',
    accessorFn: (row) => row.contact?.email ?? '—',
    header: 'Email',
  },
  {
    id: 'phone',
    accessorFn: (row) => row.contact?.phone ?? '—',
    header: 'Telefon',
  },
];

export default function VolunteersScreen() {
  const query = useMemberDirectory();
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const members = query.data ?? [];
  const departments = [
    ...new Set(members.flatMap((member) => member.departments)),
  ].sort((a, b) => a.localeCompare(b, 'ro'));
  const normalize = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('ro');
  const visible = members.filter(
    (member) =>
      normalize(member.name).includes(normalize(search.trim())) &&
      (!department || member.departments.includes(department)),
  );
  // Contact columns appear only when the protected view supplied contact rows.
  const columns: DataTableColumn<DirectoryMember>[] = (
    members.some((member) => member.contact)
      ? [...baseColumns, ...contactColumns]
      : baseColumns
  ).map((column) => ({
    ...column,
    sortingFn: (left, right, columnId) => {
      const a = left.getValue<string | number>(columnId);
      const b = right.getValue<string | number>(columnId);
      return typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), 'ro');
    },
  }));
  return (
    <section
      className="min-w-0 space-y-5 p-4 md:p-6"
      aria-labelledby="directory-title"
    >
      <header>
        <h1 id="directory-title" className="text-2xl font-bold">
          Membri OSUBB
        </h1>
        <p className="text-muted-foreground">
          Caută un membru și vezi rolul, echipele și punctele sale din taskuri.
        </p>
      </header>
      {query.isPending ? (
        <p role="status">Se încarcă membrii…</p>
      ) : query.isError ? (
        <div role="alert" className="space-y-3">
          <p>Nu am putut încărca membrii.</p>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => query.refetch()}
          >
            Încearcă din nou
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            <label className="grid gap-1 text-sm">
              Caută după nume
              <input
                type="search"
                className="min-h-11 rounded-md border border-input bg-background px-3"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Departament
              <select
                className="min-h-11 rounded-md border border-input bg-background px-3"
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
              >
                <option value="">Toate departamentele</option>
                {departments.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            {visible.length} membri
          </p>
          <DataTable
            columns={columns}
            data={visible}
            initialSorting={[{ id: 'name', desc: false }]}
            emptyTitle={
              members.length
                ? 'Niciun membru nu corespunde filtrelor.'
                : 'Niciun membru disponibil.'
            }
          />
        </>
      )}
    </section>
  );
}
