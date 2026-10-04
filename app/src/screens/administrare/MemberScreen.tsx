import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { cn } from 'cn';
import { GraduationCap, History, Pencil } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';
import {
  BackLink,
  backLinkState,
  ListRow,
  Page,
  PageHeader,
  Panel,
  panelBoxClass,
  rowListClass,
} from '../../components/layout';
import { memberDisplayName } from '../../components/member/member-identity';
import type { MemberCardGroup } from '../../queries/member-card';
import { Empty, ErrorState, Loading } from '../../components/states';
import { Button } from '../../components/ui/button';
import { MemberAvatar } from '../../components/ui/combobox';
import { FieldError } from '../../components/ui/field';
import { useAuth } from '../../lib/auth';
import { useCapabilities, type Capabilities } from '../../lib/capabilities';
import { memberEditRights } from '../../lib/member-edit-rights';
import { formatDayMonthYear, formatPoints } from '../../lib/format';
import { isUuid } from '../../lib/ids';
import { bucharestDayKey } from '../../lib/calendar-time';
import {
  fieldForReason,
  joinedAtFieldForReason,
  memberIdentitySchema,
  memberJoinedAtSchema,
} from '../../lib/schemas/member-identity';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  useAdminMember,
  useUpdateMemberIdentity,
  useUpdateMemberJoinedAt,
  type AdminMember,
  type LedgerRow,
} from '../../queries/admin-member';
import { useAdminGroups, useMyGroupRoles } from '../../queries/groups-admin';
import {
  acknowledgementLabel,
  useMemberAcknowledgement,
} from '../../queries/privacy';
import { statusLabel } from '../volunteers/directory-filters';
import { useReceiptTurn } from '../tracker/receipt-turn';
import { ReceiptTurnScope } from '../tracker/ReceiptTurnScope';
import { ReinvitePanel } from './ReinvitePanel';
import { MemberRoleTimeline } from '../profile/RoleTimeline';
import { RolePanel } from './RolePanel';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2';
const SAVE_FAILED =
  'Nu am putut salva numele. Verifică permisiunile și reîncearcă.';
const JOINED_SAVE_FAILED =
  'Nu am putut salva data intrării. Verifică permisiunile și reîncearcă.';

/**
 * The Nickname and the full name, for BC and the Moderator only (ruling R5).
 * The page mounts it behind `memberEditRights(...).profile` (#944); the
 * database refuses anyone else whatever the browser sends.
 */
function IdentityEditor({ member }: { member: AdminMember }) {
  const [nickname, setNickname] = useState(member.nickname ?? '');
  const [fullName, setFullName] = useState(member.fullName);
  const [message, setMessage] = useState<string | null>(null);
  const turn = useReceiptTurn();
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
      turn.claim();
    } catch (failure) {
      form.fail(failure, SAVE_FAILED);
    }
  }

  return (
    <Panel eyebrow="Cont" icon={Pencil} title="Nume și pseudonim">
      <form noValidate onSubmit={save} className="grid gap-3">
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
          <p
            id="member-nickname-hint"
            className="text-sm text-muted-foreground"
          >
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
        <Button
          type="submit"
          block
          className="sm:justify-self-start"
          disabled={change.isPending}
        >
          {change.isPending ? 'Se salvează…' : 'Salvează numele'}
        </Button>
        <FieldError>{form.formError}</FieldError>
        {message && turn.current && <p role="status">{message}</p>}
      </form>
    </Panel>
  );
}

/**
 * A ledger row's source: the Task by its title (B61). The id stands in only
 * when the Task itself is not readable to this viewer (RLS answers null).
 */
function LedgerSource({ row }: { row: LedgerRow }) {
  if (row.task_id !== null)
    return (
      <Link
        className="underline underline-offset-4"
        to={`/tracker?task=${row.task_id}`}
      >
        {row.task_title?.trim() || `Task #${row.task_id}`}
      </Link>
    );
  return <>{row.reason === 'sanction' ? 'Sancțiune' : 'Ajustare'}</>;
}

/**
 * Where the back link goes when the link that opened this page did not say
 * (`state.from` wins, navigation D4): the Membri tab for whoever may open it,
 * else the Grupuri tab — a Group Manager or Responsible arrives from a Roster
 * and must never be bounced to Acasă by a tab they cannot open.
 */
function memberBackTarget(capabilities: Capabilities | undefined) {
  return capabilities?.manageRoles === true ||
    capabilities?.provisionMembers === true
    ? '/administrare/membri'
    : '/administrare/grupuri';
}

function BackToAdministrare({
  capabilities,
}: {
  capabilities: Capabilities | undefined;
}) {
  return (
    <BackLink
      to={memberBackTarget(capabilities)}
      label="Înapoi la Administrare"
    />
  );
}

const EYEBROW = 'Administrare';

/** A Manager or Responsible row, not a plain membership. */
function hasGroupRole(group: MemberCardGroup) {
  return group.groupRole === 'manager' || group.groupRole === 'responsible';
}

/**
 * One identity fact: a 13 px muted label over a 16 px value (layout AD2), so
 * the label never reads as another value.
 */
function Fact({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-[length:var(--fs-sm)] text-muted-foreground">
        {label}
      </dt>
      <dd className={cn('m-0 text-[length:var(--fs-md)]', className)}>
        {children}
      </dd>
    </div>
  );
}

/**
 * "Data intrării" for BC and the Moderator (#932): the date tenure counts
 * from, with Editează → a date → Salvează / Renunță in place. The write is
 * `profiles_update_self` plus the #160 column grant; the privileged-column
 * guard refuses anyone below level 6 whatever the browser sends. Mounted
 * behind `memberEditRights(...).profile`, so a BC gets it on a BC's or the
 * Moderator's page too (#944).
 */
function JoinDateFact({ member }: { member: AdminMember }) {
  const hintId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(member.joinedAt ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const turn = useReceiptTurn();
  const change = useUpdateMemberJoinedAt();
  const today = bucharestDayKey(new Date()) ?? '';
  const form = useFormValidation(
    memberJoinedAtSchema(today),
    { joinedAt: draft },
    joinedAtFieldForReason,
  );
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const joined = formatDayMonthYear(member.joinedAt);

  // Back from the editor, focus returns to the button that opened it.
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (change.isPending) return;
    const values = form.validate();
    if (!values) return;
    try {
      await change.mutateAsync({
        memberId: member.memberId,
        joinedAt: values.joinedAt,
      });
      setMessage('Data intrării a fost salvată.');
      turn.claim();
      setEditing(false);
    } catch (failure) {
      form.fail(failure, JOINED_SAVE_FAILED);
    }
  }

  return (
    <div
      data-slot="joined-at"
      className={cn('grid min-w-0 gap-0.5', editing && 'sm:col-span-2')}
    >
      <dt className="text-[length:var(--fs-sm)] text-muted-foreground">
        Data intrării
      </dt>
      <dd className="m-0 grid gap-2 text-[length:var(--fs-md)]">
        {editing ? (
          <form noValidate onSubmit={save} className="grid max-w-md gap-3">
            <input
              type="date"
              aria-label="Data intrării"
              className={control}
              value={draft}
              max={today || undefined}
              disabled={change.isPending}
              autoFocus
              onChange={(event) => {
                setDraft(event.target.value);
                // A refusal was about the old date.
                form.reset();
              }}
              {...form.field('joinedAt', hintId)}
            />
            <p id={hintId} className="m-0 text-sm text-muted-foreground">
              Vechimea pentru promovări se numără de la această dată.
            </p>
            <FieldError {...form.errorProps('joinedAt')} />
            <FieldError>{form.formError}</FieldError>
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                className="flex-1 sm:flex-none"
                disabled={change.isPending || draft === (member.joinedAt ?? '')}
              >
                {change.isPending ? 'Se salvează…' : 'Salvează'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-none"
                disabled={change.isPending}
                onClick={() => {
                  setDraft(member.joinedAt ?? '');
                  setEditing(false);
                }}
              >
                Renunță
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {joined ? (
              <span>{joined}</span>
            ) : (
              <span className="inline-flex min-h-7 w-fit items-center rounded-full border border-dashed border-border px-3 text-sm font-semibold text-muted-foreground">
                Nesetată
              </span>
            )}
            <Button
              ref={editButton}
              variant="outline"
              size="sm"
              aria-label="Editează data intrării"
              onClick={() => {
                setMessage(null);
                setDraft(member.joinedAt ?? '');
                setEditing(true);
              }}
            >
              Editează
            </Button>
          </div>
        )}
        {/* Unset, the promotion job counts no tenure (#51). */}
        {!editing && !joined && (
          <p className="m-0 text-sm text-muted-foreground">
            Fără ea, membrul nu acumulează vechime pentru promovări.
          </p>
        )}
        {message && !editing && turn.current && (
          <p role="status" className="m-0 text-sm font-medium">
            {message}
          </p>
        )}
      </dd>
    </div>
  );
}

function MemberUnavailable({
  capabilities,
}: {
  capabilities: Capabilities | undefined;
}) {
  return (
    <Page>
      <BackToAdministrare capabilities={capabilities} />
      <PageHeader eyebrow={EYEBROW} title="Membru indisponibil" />
    </Page>
  );
}

function PointsPanel({ points }: { points: readonly LedgerRow[] }) {
  return (
    <Panel
      eyebrow="Puncte"
      icon={History}
      title="Istoric puncte"
      flush={points.length > 0}
    >
      {!points.length ? (
        <Empty text="Nu există înregistrări pe care le poți vedea." />
      ) : (
        <ul className={rowListClass}>
          {points.map((row) => (
            <ListRow
              key={row.id}
              value={
                <strong>
                  {row.delta > 0 ? '+' : ''}
                  {formatPoints(row.delta)} puncte
                </strong>
              }
            >
              {new Date(row.created_at).toLocaleDateString('ro-RO')} ·{' '}
              <LedgerSource row={row} />
            </ListRow>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * One Member's page in Administrare (#103; ADR-0009 §Management surface).
 * Everything on it is what the server returned for this viewer: the Member
 * Card's Groups (Private Groups already filtered), contact details only when
 * `member_contacts()` answers, and only the ledger rows RLS lets them read.
 * A sub-page of the Membri tab: back link, no tab bar (#825).
 */
export default function MemberScreen() {
  const { memberId: raw } = useParams();
  // A malformed id is no Member: nothing is queried and the page says so.
  const memberId = isUuid(raw) ? raw : undefined;
  const member = useAdminMember(memberId);
  const capabilities = useCapabilities();
  const viewerId = useAuth().session?.user.id;
  const groups = useAdminGroups();
  const mine = useMyGroupRoles();
  const location = useLocation();
  // #771: BC and the Moderator see the Member's Privacy Acknowledgement.
  const privacy = useMemberAcknowledgement(
    memberId,
    capabilities.data?.manageRoles === true,
  );
  if (!memberId) return <MemberUnavailable capabilities={capabilities.data} />;
  if (
    member.isPending ||
    capabilities.isPending ||
    groups.isPending ||
    mine.isPending
  )
    return (
      <Page aria-label="Membru">
        <Loading label="Se încarcă membrul…" />
      </Page>
    );
  if (member.isError || capabilities.isError || groups.isError || mine.isError)
    return (
      <Page aria-label="Membru">
        <BackToAdministrare capabilities={capabilities.data} />
        <ErrorState text="Nu am putut încărca membrul. Reîncarcă pagina." />
      </Page>
    );
  const data = member.data;
  if (!data) return <MemberUnavailable capabilities={capabilities.data} />;

  // BC and the Moderator see every membership; a Group Manager or
  // Responsible, only those in the Groups they lead and below.
  const leads = capabilities.data?.manageRoles === true;
  // One predicate for every edit control below, mirroring the server (#944).
  const rights = memberEditRights({ id: viewerId, leads }, data.memberId);
  const visibleGroups = data.groups.filter((row) => {
    if (leads) return true;
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
  // A Group page opened from here comes back here (navigation D4, A63).
  // A label, not the name: names render only through MemberName.
  const fromHere = backLinkState(location, 'Înapoi la membru');
  const joined = formatDayMonthYear(data.joinedAt);

  // One receipt at a time on the page: a new command's replaces the last
  // (F-11, the D-16 rule of the Task sheet).
  return (
    // Keyed by Member: opening another one remounts every editor below.
    <ReceiptTurnScope key={data.memberId}>
      <Page>
        <BackToAdministrare capabilities={capabilities.data} />
        <PageHeader
          eyebrow={EYEBROW}
          title={
            <span className="inline-flex max-w-full min-w-0 items-center gap-3">
              <MemberAvatar
                name={data.fullName}
                avatarColor={data.avatarColor}
                className="size-10 text-sm"
              />
              <span className="min-w-0">{name}</span>
            </span>
          }
          description={name !== data.fullName ? data.fullName : undefined}
        />
        <dl className={`${panelBoxClass} grid gap-x-6 gap-y-4 sm:grid-cols-2`}>
          <Fact label="Rol organizațional">
            <span className="font-semibold">{data.roleLabel ?? '—'}</span>
            {/* A Board Title names the Role (#963); the rank follows it. */}
            {data.rankLabel && data.rankLabel !== data.roleLabel && (
              <span className="text-muted-foreground"> · {data.rankLabel}</span>
            )}
          </Fact>
          <Fact label="Status">
            {data.status ? statusLabel(data.status) : '—'}
          </Fact>
          {/* BC and the Moderator set the date tenure counts from (#932);
              for anyone else an imported Member who never signed in has no
              date yet (F-28). */}
          {rights.profile ? (
            <JoinDateFact member={data} />
          ) : (
            joined && <Fact label="Membru din">{joined}</Fact>
          )}
          {data.contact?.email && (
            <Fact label="Email" className="break-all">
              {data.contact.email}
            </Fact>
          )}
          {data.contact?.phone && (
            <Fact label="Telefon">{data.contact.phone}</Fact>
          )}
          {leads && (
            <Fact label="Politica de confidențialitate">
              {privacy.isPending
                ? 'Se încarcă…'
                : privacy.isError
                  ? '—'
                  : acknowledgementLabel(privacy.data)}
            </Fact>
          )}
        </dl>
        {rights.profile && <IdentityEditor member={data} />}
        {rights.profile && <ReinvitePanel memberId={data.memberId} />}
        {/* No eyebrow: it would only repeat the title (ruling 2, F-24). */}
        <Panel title="Grupuri" flush={visibleGroups.length > 0}>
          {!visibleGroups.length ? (
            <Empty text="Nu există grupuri în aria ta de administrare." />
          ) : (
            <ul className={rowListClass}>
              {visibleGroups.map((group) => (
                <ListRow key={group.id}>
                  <Link
                    className="font-semibold underline-offset-4 hover:underline"
                    to={`/administrare/grupuri/${group.id}`}
                    state={fromHere}
                  >
                    {group.label}
                  </Link>
                  {/* A plain membership says nothing the list does not (B60). */}
                  {hasGroupRole(group) && (
                    <p className="m-0 text-sm text-muted-foreground">
                      Rol în grup: {group.roleLabel}
                    </p>
                  )}
                </ListRow>
              ))}
            </ul>
          )}
        </Panel>
        {rights.rankAndStatus && <RolePanel selectedMemberId={data.memberId} />}
        {/* role_history_read answers another Member's rows to level 6 only. */}
        {leads && data.role && (
          <Panel eyebrow="Parcurs" icon={GraduationCap} title="Istoric roluri">
            <MemberRoleTimeline
              memberId={data.memberId}
              joinedAt={data.joinedAt}
              role={data.role}
            />
          </Panel>
        )}
        <PointsPanel points={data.points} />
      </Page>
    </ReceiptTurnScope>
  );
}
