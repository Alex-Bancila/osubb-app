import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { useCapabilities } from '../../lib/capabilities';
import {
  useAdminMember,
  useUpdateMemberIdentity,
} from '../../queries/admin-member';
import { useAdminGroups, useMyGroupRoles } from '../../queries/groups-admin';
import { useRoles } from '../../queries/reference';
import { RolePanel } from './RolePanel';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2';
function IdentityEditor({
  memberId,
  nickname,
  fullName,
}: {
  memberId: string;
  nickname: string | null;
  fullName: string;
}) {
  const [name, setName] = useState(fullName);
  const [nick, setNick] = useState(nickname ?? '');
  const change = useUpdateMemberIdentity();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-3 rounded-xl border p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (change.isPending) return;
        setError(null);
        setMessage(null);
        try {
          await change.mutateAsync({
            memberId,
            nickname: nick,
            fullName: name,
          });
          setMessage('Numele a fost actualizat.');
        } catch (failure) {
          const reason =
            failure && typeof failure === 'object' && 'message' in failure
              ? String(failure.message)
              : '';
          setError(
            (
              {
                nickname_taken: 'Acest nickname este deja folosit.',
                nickname_too_short:
                  'Nickname-ul trebuie să aibă cel puțin 2 caractere.',
                nickname_too_long:
                  'Nickname-ul poate avea cel mult 24 de caractere.',
                nickname_invalid:
                  'Folosește litere, cifre, spații, punct, cratimă sau underscore.',
              } as Record<string, string>
            )[reason] ??
              'Nu am putut salva numele. Verifică permisiunile și reîncearcă.',
          );
        }
      }}
    >
      <h2 className="text-lg font-semibold">Nume și nickname</h2>
      <label className="grid gap-1">
        Nickname
        <input
          className={control}
          value={nick}
          maxLength={24}
          onChange={(event) => setNick(event.target.value)}
          disabled={change.isPending}
        />
      </label>
      <p className="text-sm text-muted-foreground">
        Dacă îl lași gol, se afișează numele complet.
      </p>
      <label className="grid gap-1">
        Nume complet
        <input
          className={control}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={change.isPending}
        />
      </label>
      <Button type="submit" disabled={change.isPending || !name.trim()}>
        {change.isPending ? 'Se salvează…' : 'Salvează numele'}
      </Button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export default function MemberScreen() {
  const { memberId } = useParams();
  const member = useAdminMember(memberId);
  const capabilities = useCapabilities();
  const roles = useRoles();
  const groups = useAdminGroups();
  const mine = useMyGroupRoles();
  if (
    member.isPending ||
    capabilities.isPending ||
    groups.isPending ||
    mine.isPending
  )
    return <p role="status">Se încarcă membrul…</p>;
  if (member.isError || capabilities.isError || groups.isError || mine.isError)
    return <p role="alert">Nu am putut încărca membrul. Reîncarcă pagina.</p>;
  if (!member.data)
    return (
      <section className="page">
        <h1>Membru indisponibil</h1>
        <Link to="/administrare">Înapoi la Administrare</Link>
      </section>
    );
  const { card, contact, status, points } = member.data;
  const canEdit = capabilities.data?.manageRoles === true;
  const visibleGroups = member.data.memberships.filter((row) => {
    const group = groups.data.find((g) => g.id === row.group_id);
    return (
      canEdit ||
      (group &&
        mine.data.some(
          (role) =>
            group.path.includes(role.id) &&
            (role.group_role === 'manager' ||
              role.group_role === 'responsible'),
        ))
    );
  });
  return (
    <section className="page space-y-6">
      <Link className="underline" to="/administrare">
        Înapoi la Administrare
      </Link>
      <header>
        <p className="text-sm text-muted-foreground">Administrare · Membru</p>
        <h1 className="text-2xl font-semibold">
          {card.nickname ?? card.full_name}
        </h1>
        {card.nickname && (
          <p className="text-muted-foreground">{card.full_name}</p>
        )}
      </header>
      <dl className="grid gap-3 rounded-xl border p-5 sm:grid-cols-2">
        <div>
          <dt>Rol organizațional</dt>
          <dd className="font-medium">
            {roles.data?.get(card.role)?.name ?? card.role}
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            {status === 'activ'
              ? 'Activ'
              : status === 'inactiv'
                ? 'Inactiv'
                : status === 'alumni'
                  ? 'Alumni'
                  : '—'}
          </dd>
        </div>
        <div>
          <dt>Membru din</dt>
          <dd>{card.joined_at ?? '—'}</dd>
        </div>
        {contact?.email && (
          <div>
            <dt>Email</dt>
            <dd className="break-all">{contact.email}</dd>
          </div>
        )}
        {contact?.phone && (
          <div>
            <dt>Telefon</dt>
            <dd>{contact.phone}</dd>
          </div>
        )}
      </dl>
      {canEdit && (
        <IdentityEditor
          key={`${card.member_id}:${card.nickname}:${card.full_name}`}
          memberId={card.member_id}
          nickname={card.nickname}
          fullName={card.full_name}
        />
      )}
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-lg font-semibold">Grupuri</h2>
        {!visibleGroups.length ? (
          <p>Nu există grupuri în aria ta de administrare.</p>
        ) : (
          <ul className="space-y-3">
            {visibleGroups.map((group) => (
              <li key={group.group_id}>
                <Link
                  className="font-medium underline"
                  to={`/administrare/grupuri/${group.group_id}`}
                >
                  {group.name}
                </Link>
                <p className="text-sm text-muted-foreground">
                  Rol în grup:{' '}
                  {group.group_role === 'manager'
                    ? (groups.data.find((g) => g.id === group.group_id)
                        ?.manager_title ?? 'Coordonator')
                    : group.group_role === 'responsible'
                      ? (group.position_title ?? 'Responsabil')
                      : 'Membru'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canEdit && (
        <RolePanel key={card.member_id} selectedMemberId={card.member_id} />
      )}
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-lg font-semibold">Istoric puncte</h2>
        {!points.length ? (
          <p>Nu există înregistrări pe care le poți vedea.</p>
        ) : (
          <ul className="divide-y">
            {points.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap justify-between gap-2 py-3"
              >
                <span>
                  {new Date(row.created_at).toLocaleDateString('ro-RO')} ·{' '}
                  {row.task_id ? (
                    <Link className="underline" to={`/taskuri/${row.task_id}`}>
                      Task #{row.task_id}
                    </Link>
                  ) : (
                    'Ajustare'
                  )}
                </span>
                <strong>
                  {row.delta > 0 ? '+' : ''}
                  {row.delta} puncte
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
