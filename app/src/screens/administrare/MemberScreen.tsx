import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { memberDisplayName } from '../../components/member/member-identity';
import { Empty, ErrorState, Loading } from '../../components/states';
import { Button } from '../../components/ui/button';
import { MemberAvatar } from '../../components/ui/combobox';
import { FieldError } from '../../components/ui/field';
import { useCapabilities } from '../../lib/capabilities';
import { formatDayMonthYear, formatPoints } from '../../lib/format';
import {
  fieldForReason,
  memberIdentitySchema,
} from '../../lib/schemas/member-identity';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  useAdminMember,
  useUpdateMemberIdentity,
  type AdminMember,
  type LedgerRow,
} from '../../queries/admin-member';
import { useAdminGroups, useMyGroupRoles } from '../../queries/groups-admin';
import { statusLabel } from '../volunteers/directory-filters';
import { ReinvitePanel } from './ReinvitePanel';
import { RolePanel } from './RolePanel';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2';
const SAVE_FAILED =
  'Nu am putut salva numele. Verifică permisiunile și reîncearcă.';

/**
 * The Nickname and the full name, for BC and the Moderator only (ruling R5).
 * The page mounts it behind the server's `manageRoles` capability; the
 * database refuses anyone else whatever the browser sends.
 */
function IdentityEditor({ member }: { member: AdminMember }) {
  const [nickname, setNickname] = useState(member.nickname ?? '');
  const [fullName, setFullName] = useState(member.fullName);
  const [message, setMessage] = useState<string | null>(null);
  const change = useUpdateMemberIdentity();
  const form = useFormValidation(
    memberIdentitySchema,
    { nickname, fullName },
    fieldForReason,
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (change.isPending) return;
    setMessage(null);
    const values = form.validate();
    if (!values) return;
    try {
      await change.mutateAsync({ memberId: member.memberId, ...values });
      // Show what was stored (trimmed, blank Nickname as none); the refetch
      // that follows keeps this editor mounted, so the message stays.
      setNickname(values.nickname ?? '');
      setFullName(values.fullName);
      setMessage('Numele a fost actualizat.');
    } catch (failure) {
      form.fail(failure, SAVE_FAILED);
    }
  }

  return (
    <form
      noValidate
      onSubmit={save}
      className="grid gap-3 rounded-xl border p-5"
    >
      <h2 className="text-lg font-semibold">Nume și pseudonim</h2>
      <div className="grid gap-1.5">
        <label className="grid gap-1">
          Pseudonim
          <input
            className={control}
            value={nickname}
            disabled={change.isPending}
            onChange={(event) => setNickname(event.target.value)}
            {...form.field('nickname', 'member-nickname-hint')}
          />
        </label>
        <p id="member-nickname-hint" className="text-sm text-muted-foreground">
          Dacă îl lași gol, se afișează numele complet.
        </p>
        <FieldError {...form.errorProps('nickname')} />
      </div>
      <div className="grid gap-1.5">
        <label className="grid gap-1">
          Nume complet
          <input
            className={control}
            value={fullName}
            required
            disabled={change.isPending}
            onChange={(event) => setFullName(event.target.value)}
            {...form.field('fullName')}
          />
        </label>
        <FieldError {...form.errorProps('fullName')} />
      </div>
      <Button type="submit" disabled={change.isPending}>
        {change.isPending ? 'Se salvează…' : 'Salvează numele'}
      </Button>
      <FieldError>{form.formError}</FieldError>
      {message && <p role="status">{message}</p>}
    </form>
  );
}

function LedgerSource({ row }: { row: LedgerRow }) {
  if (row.task_id !== null)
    return (
      <Link className="underline" to={`/tracker?task=${row.task_id}`}>
        Task #{row.task_id}
      </Link>
    );
  return <>{row.reason === 'sanction' ? 'Sancțiune' : 'Ajustare'}</>;
}

/**
 * One Member's page in Administrare (#103; ADR-0009 §Management surface).
 * Everything on it is what the server returned for this viewer: the Member
 * Card's Groups (Private Groups already filtered), contact details only when
 * `profiles_contact` answers, and only the ledger rows RLS lets them read.
 */
export default function MemberScreen() {
  const { memberId } = useParams();
  const member = useAdminMember(memberId);
  const capabilities = useCapabilities();
  const groups = useAdminGroups();
  const mine = useMyGroupRoles();
  if (
    member.isPending ||
    capabilities.isPending ||
    groups.isPending ||
    mine.isPending
  )
    return <Loading label="Se încarcă membrul…" />;
  if (member.isError || capabilities.isError || groups.isError || mine.isError)
    return <ErrorState text="Nu am putut încărca membrul. Reîncarcă pagina." />;
  const data = member.data;
  if (!data)
    return (
      <section className="page space-y-4">
        <h1 className="text-2xl font-semibold">Membru indisponibil</h1>
        <Link className="underline" to="/administrare">
          Înapoi la Administrare
        </Link>
      </section>
    );

  // BC and the Moderator see every membership; a Group Manager or
  // Responsible, only those in the Groups they lead and below.
  const canEdit = capabilities.data?.manageRoles === true;
  const visibleGroups = data.groups.filter((row) => {
    if (canEdit) return true;
    const group = groups.data.find((candidate) => candidate.id === row.id);
    return (
      group !== undefined &&
      mine.data.some(
        (role) =>
          group.path.includes(role.id) &&
          (role.group_role === 'manager' || role.group_role === 'responsible'),
      )
    );
  });
  const name = memberDisplayName(data.nickname, data.fullName);

  return (
    <section className="page space-y-6">
      <Link className="underline" to="/administrare">
        Înapoi la Administrare
      </Link>
      <header className="flex items-center gap-3">
        <MemberAvatar
          name={data.fullName}
          avatarColor={data.avatarColor}
          className="size-12 text-base"
        />
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Administrare · Membru</p>
          <h1 className="text-2xl font-semibold break-words">{name}</h1>
          {name !== data.fullName && (
            <p className="text-muted-foreground">{data.fullName}</p>
          )}
        </div>
      </header>
      <dl className="grid gap-3 rounded-xl border p-5 sm:grid-cols-2">
        <div>
          <dt>Rol organizațional</dt>
          <dd className="font-medium">{data.roleLabel ?? '—'}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{data.status ? statusLabel(data.status) : '—'}</dd>
        </div>
        <div>
          <dt>Membru din</dt>
          <dd>{formatDayMonthYear(data.joinedAt) ?? '—'}</dd>
        </div>
        {data.contact?.email && (
          <div>
            <dt>Email</dt>
            <dd className="break-all">{data.contact.email}</dd>
          </div>
        )}
        {data.contact?.phone && (
          <div>
            <dt>Telefon</dt>
            <dd>{data.contact.phone}</dd>
          </div>
        )}
      </dl>
      {canEdit && <IdentityEditor key={data.memberId} member={data} />}
      {canEdit && (
        <ReinvitePanel key={data.memberId} memberId={data.memberId} />
      )}
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-lg font-semibold">Grupuri</h2>
        {!visibleGroups.length ? (
          <Empty text="Nu există grupuri în aria ta de administrare." />
        ) : (
          <ul className="space-y-3">
            {visibleGroups.map((group) => (
              <li key={group.id}>
                <Link
                  className="font-medium underline"
                  to={`/administrare/grupuri/${group.id}`}
                >
                  {group.label}
                </Link>
                <p className="text-sm text-muted-foreground">
                  Rol în grup: {group.roleLabel}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canEdit && (
        <RolePanel key={data.memberId} selectedMemberId={data.memberId} />
      )}
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-lg font-semibold">Istoric puncte</h2>
        {!data.points.length ? (
          <Empty text="Nu există înregistrări pe care le poți vedea." />
        ) : (
          <ul className="divide-y">
            {data.points.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap justify-between gap-2 py-3"
              >
                <span>
                  {new Date(row.created_at).toLocaleDateString('ro-RO')} ·{' '}
                  <LedgerSource row={row} />
                </span>
                <strong>
                  {row.delta > 0 ? '+' : ''}
                  {formatPoints(row.delta)} puncte
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
