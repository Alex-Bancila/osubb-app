import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Tabs } from '@base-ui/react/tabs';
import {
  Calendar,
  ChevronRight,
  GraduationCap,
  History,
  Mail,
  Pencil,
  UserRound,
  Users,
} from 'lucide-react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { SwipePanels } from '../../components/ui/swipe-panels';
import {
  BackLink,
  backLinkState,
  ListRow,
  Page,
  PageHeader,
  Panel,
  rowListClass,
  tabClass,
  tabListClass,
  tabThumbClass,
  useActiveTabInView,
} from '../../components/layout';
import { memberDisplayName } from '../../components/member/member-identity';
import type { MemberCardGroup } from '../../queries/member-card';
import { Empty, ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DatePicker } from '../../components/ui/date-picker';
import { FieldError } from '../../components/ui/field';
import { FormSheet, FormSheetFooter } from '../../components/ui/form-sheet';
import { InfoHint } from '../../components/ui/info-hint';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { useAuth } from '../../lib/auth';
import { useCapabilities, type Capabilities } from '../../lib/capabilities';
import { safeHexColor } from '../../lib/color';
import { memberEditRights } from '../../lib/member-edit-rights';
import { formatDayMonthYear, formatPoints, initials } from '../../lib/format';
import { isUuid } from '../../lib/ids';
import {
  OTHER_UNIVERSITY,
  UNIVERSITIES,
  universityOption,
} from '../../lib/universities';
import { bucharestDayKey } from '../../lib/calendar-time';
import {
  fieldForReason,
  joinedAtFieldForReason,
  memberIdentitySchema,
  memberJoinedAtSchema,
  memberUniversitySchema,
  universityFieldForReason,
} from '../../lib/schemas/member-identity';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  useAdminMember,
  useUpdateMemberIdentity,
  useUpdateMemberJoinedAt,
  useUpdateMemberUniversity,
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

const labelClass = 'text-sm font-medium';
const SAVE_FAILED =
  'Nu am putut salva numele. Verifică permisiunile și reîncearcă.';
const JOINED_SAVE_FAILED =
  'Nu am putut salva data intrării. Verifică permisiunile și reîncearcă.';
const UNIVERSITY_SAVE_FAILED =
  'Nu am putut salva universitatea. Verifică permisiunile și reîncearcă.';
const IDENTITY_FORM_ID = 'member-identity-form';

/** The page's tabs, by their `?tab=` value — as Profil's. */
const MEMBER_TABS = ['cont', 'grupuri', 'roluri', 'puncte'] as const;
type MemberTab = (typeof MEMBER_TABS)[number];
const TAB_KEY = 'tab';

/** The ring round the whole row, drawn by the link's stretched `::after`. */
const focusRingAfterClass =
  'outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-solid focus-visible:after:outline-ring';

/**
 * One fact, as on Profil: its name on the left, its value on the right. A
 * value too long for the row (an email address at 375 px) drops under the
 * name rather than squeezing it.
 */
function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li
      data-slot="setting-row"
      className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5"
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        data-slot="setting-value"
        className="min-w-0 text-right text-sm font-medium text-foreground"
      >
        {children}
      </span>
    </li>
  );
}

/** A value nobody has filled in yet, said quietly. */
function Unset({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground italic">{children}</span>;
}

/**
 * The Nickname and the full name, for BC and the Moderator only (ruling R5):
 * the form of the **Nume și poreclă** sheet, submitted by the sheet's
 * pinned button. The page mounts it behind `memberEditRights(...).profile`
 * (#944); the database refuses anyone else whatever the browser sends.
 */
function IdentityForm({
  member,
  pending,
  onSave,
}: {
  member: AdminMember;
  pending: boolean;
  /** Sends the names; a refusal comes back as the thrown failure. */
  onSave: (values: {
    nickname: string | null;
    fullName: string;
  }) => Promise<void>;
}) {
  const id = useId();
  const [nickname, setNickname] = useState(member.nickname ?? '');
  const [fullName, setFullName] = useState(member.fullName);
  const form = useFormValidation(
    memberIdentitySchema,
    { nickname, fullName },
    fieldForReason,
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const values = form.validate();
    if (!values) return;
    try {
      await onSave(values);
    } catch (failure) {
      form.fail(failure, SAVE_FAILED);
    }
  }

  return (
    <form
      id={IDENTITY_FORM_ID}
      noValidate
      onSubmit={save}
      className="grid gap-4"
    >
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${id}-nickname`} className={labelClass}>
            Poreclă (opțional)
          </label>
          <InfoHint label="Despre poreclă" id="member-nickname-hint">
            Dacă o lași goală, se afișează numele complet.
          </InfoHint>
        </div>
        <Input
          id={`${id}-nickname`}
          value={nickname}
          disabled={pending}
          onChange={(event) => setNickname(event.target.value)}
          {...form.field('nickname', 'member-nickname-hint')}
        />
        <FieldError {...form.errorProps('nickname')} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-full-name`} className={labelClass}>
          Nume complet
        </label>
        <Input
          id={`${id}-full-name`}
          value={fullName}
          required
          disabled={pending}
          onChange={(event) => setFullName(event.target.value)}
          {...form.field('fullName')}
        />
        <FieldError {...form.errorProps('fullName')} />
      </div>
      <FieldError>{form.formError}</FieldError>
    </form>
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
  // #1017: a Task deleted for good keeps its name on the award and its reversal.
  if (row.deleted_task_title) return <>Task șters: {row.deleted_task_title}</>;
  return <>{row.reason === 'sanction' ? 'Sancțiune' : 'Ajustare'}</>;
}

/**
 * Where the back link goes when the link that opened this page did not say
 * (`state.from` wins, navigation D4): the Membri tab for whoever may open it,
 * else the Grupuri tab — a Group Manager or Responsible arrives from a
 * Group's Membri tab and must never be bounced to Acasă by a tab they cannot
 * open.
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

/** A Manager or Responsible row, not a plain membership. */
function hasGroupRole(group: MemberCardGroup) {
  return group.groupRole === 'manager' || group.groupRole === 'responsible';
}

/**
 * The Salvează / Renunță of a row's inline editor. Neither is filled: a page
 * keeps one filled button.
 */
function RowEditorButtons({
  pending,
  unchanged,
  onCancel,
}: {
  pending: boolean;
  /** The draft is what is stored: there is nothing to save. */
  unchanged: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="submit"
        variant="outline"
        className="flex-1 sm:flex-none"
        disabled={pending || unchanged}
      >
        {pending ? 'Se salvează…' : 'Salvează'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="flex-1 sm:flex-none"
        disabled={pending}
        onClick={onCancel}
      >
        Renunță
      </Button>
    </div>
  );
}

/**
 * "Data intrării" for BC and the Moderator (#932): the date tenure counts
 * from, as a row whose pencil opens a date (the app's `DatePicker`) with
 * Salvează / Renunță in place. The picker has no upper bound, so a day in the
 * future can be chosen: the schema refuses it under the field before anything
 * is sent. The write is
 * `profiles_update_self` plus the #160 column grant; the privileged-column
 * guard refuses anyone below level 6 whatever the browser sends. Mounted
 * behind `memberEditRights(...).profile`, so a BC gets it on a BC's or the
 * Moderator's page too (#944).
 */
function JoinDateRow({ member }: { member: AdminMember }) {
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
  // Checked when the member leaves the field; the picker itself does not
  // count opening its calendar as leaving.
  const joinedField = form.field('joinedAt', hintId);

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
    <li
      data-slot="joined-at"
      className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5"
    >
      <span className="text-sm text-muted-foreground">Data intrării</span>
      {editing ? (
        <form noValidate onSubmit={save} className="grid w-full max-w-md gap-3">
          <div className="flex items-center gap-1">
            <DatePicker
              aria-label="Data intrării"
              value={draft}
              required
              max={today || undefined}
              disabled={change.isPending}
              autoFocus
              onChange={(next) => {
                setDraft(next);
                // A refusal was about the old date.
                form.reset();
              }}
              {...joinedField}
            />
            <InfoHint label="Despre data intrării" id={hintId}>
              Vechimea pentru promovări se numără de la această dată.
            </InfoHint>
          </div>
          <FieldError {...form.errorProps('joinedAt')} />
          <FieldError>{form.formError}</FieldError>
          <RowEditorButtons
            pending={change.isPending}
            unchanged={draft === (member.joinedAt ?? '')}
            onCancel={() => {
              setDraft(member.joinedAt ?? '');
              setEditing(false);
            }}
          />
        </form>
      ) : (
        <span
          data-slot="setting-value"
          className="flex min-w-0 items-center gap-2 text-sm font-medium"
        >
          {joined ?? <Unset>Nesetată</Unset>}
          <Button
            ref={editButton}
            variant="outline"
            size="icon"
            aria-label="Editează data intrării"
            title="Editează data intrării"
            onClick={() => {
              setMessage(null);
              setDraft(member.joinedAt ?? '');
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
          </Button>
        </span>
      )}
      {/* Unset, the promotion job counts no tenure (#51). */}
      {!editing && !joined && (
        <p className="m-0 basis-full text-sm text-muted-foreground">
          Fără ea, membrul nu acumulează vechime pentru promovări.
        </p>
      )}
      {message && !editing && turn.current && (
        <p role="status" className="m-0 basis-full text-sm font-medium">
          {message}
        </p>
      )}
    </li>
  );
}

/**
 * The select's draft for a stored Universitate: its list entry, or "Altă
 * universitate" with the stored name as the free text.
 */
function universityDraft(university: string | null) {
  const option = universityOption(university) ?? '';
  return {
    option,
    other: option === OTHER_UNIVERSITY ? (university ?? '') : '',
  };
}

/** The Universitate select's entries: the list, then the free-text one. */
const UNIVERSITY_CHOICES = [
  ...UNIVERSITIES.map((name) => ({ value: name, label: name })),
  { value: OTHER_UNIVERSITY, label: 'Altă universitate' },
];

/**
 * "Universitate" for BC and the Moderator (R58), beside the join date: a row
 * whose pencil opens the app's `Select` of the universities of Cluj, with
 * "Altă universitate" opening a text field for any other name, and Salvează /
 * Renunță in place. Only a student of Universitatea Babeș-Bolyai may be
 * granted Drept de Vot, which the Roluri panel reads from this. The write is
 * `profiles_update_self` plus the column grant; the privileged-column guard
 * refuses anyone below level 6 whatever the browser sends. Mounted behind
 * `memberEditRights(...).profile`, like the join date.
 */
function UniversityRow({ member }: { member: AdminMember }) {
  const nameId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(universityDraft(member.university));
  const [message, setMessage] = useState<string | null>(null);
  const turn = useReceiptTurn();
  const change = useUpdateMemberUniversity();
  const chosen =
    draft.option === OTHER_UNIVERSITY ? draft.other.trim() : draft.option;
  // The hook hides a refusal once the value at the field it was shown under
  // changes, and that field is `university`, not the draft's `option` and
  // `other`: the values it reads carry the chosen name under that key.
  const validated = { ...draft, university: chosen };
  const form = useFormValidation(
    memberUniversitySchema,
    validated,
    universityFieldForReason,
  );
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

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
        university: values.university,
      });
      setMessage('Universitatea a fost salvată.');
      turn.claim();
      setEditing(false);
    } catch (failure) {
      form.fail(failure, UNIVERSITY_SAVE_FAILED);
    }
  }

  return (
    <li
      data-slot="university"
      className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5"
    >
      <span className="text-sm text-muted-foreground">Universitate</span>
      {editing ? (
        <form noValidate onSubmit={save} className="grid w-full max-w-md gap-3">
          <Select
            aria-label="Universitate"
            value={draft.option}
            placeholder="Alege universitatea"
            options={UNIVERSITY_CHOICES}
            disabled={change.isPending}
            autoFocus
            onValueChange={(option) => {
              setDraft({ ...draft, option });
              // A refusal was about the old choice.
              form.reset();
            }}
          />
          {draft.option === OTHER_UNIVERSITY && (
            <div className="grid gap-1.5">
              <label htmlFor={nameId} className={labelClass}>
                Numele universității
              </label>
              <Input
                id={nameId}
                value={draft.other}
                disabled={change.isPending}
                onChange={(event) =>
                  setDraft({ ...draft, other: event.target.value })
                }
                {...form.field('university')}
              />
            </div>
          )}
          <FieldError {...form.errorProps('university')} />
          <FieldError>{form.formError}</FieldError>
          <RowEditorButtons
            pending={change.isPending}
            unchanged={chosen === (member.university ?? '')}
            onCancel={() => {
              setDraft(universityDraft(member.university));
              form.reset();
              setEditing(false);
            }}
          />
        </form>
      ) : (
        <span
          data-slot="setting-value"
          className="flex min-w-0 items-center gap-2 text-sm font-medium"
        >
          {member.university ? (
            <span className="wrap-anywhere">{member.university}</span>
          ) : (
            <Unset>Necompletată</Unset>
          )}
          <Button
            ref={editButton}
            variant="outline"
            size="icon"
            aria-label="Editează universitatea"
            title="Editează universitatea"
            onClick={() => {
              setMessage(null);
              setDraft(universityDraft(member.university));
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
          </Button>
        </span>
      )}
      {message && !editing && turn.current && (
        <p role="status" className="m-0 basis-full text-sm font-medium">
          {message}
        </p>
      )}
    </li>
  );
}

/**
 * The Cont tab's facts: the names, the join date, the contact details the
 * server answered and, for BC and the Moderator, the Privacy Acknowledgement.
 * Its header's pencil opens **Nume și poreclă** for whoever may edit them;
 * the receipt lands on the page the sheet closes onto.
 */
function AccountPanel({
  member,
  canEdit,
  leads,
}: {
  member: AdminMember;
  /** `memberEditRights(...).profile`: the names and the join date. */
  canEdit: boolean;
  /** BC and the Moderator: the Privacy Acknowledgement is theirs to see. */
  leads: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const turn = useReceiptTurn();
  const change = useUpdateMemberIdentity();
  // #771: BC and the Moderator see the Member's Privacy Acknowledgement.
  const privacy = useMemberAcknowledgement(member.memberId, leads);

  return (
    <Panel
      title="Date de cont"
      control={
        canEdit && (
          <Button
            ref={editButton}
            variant="outline"
            size="icon"
            aria-label="Editează numele și porecla"
            title="Editează numele și porecla"
            onClick={() => {
              setMessage(null);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
          </Button>
        )
      }
      stack={2}
    >
      <ul className={rowListClass}>
        <FactRow label="Nume complet">
          <span className="wrap-anywhere">{member.fullName}</span>
        </FactRow>
        <FactRow label="Poreclă">
          {member.nickname?.trim() ? (
            <span className="wrap-anywhere">{member.nickname}</span>
          ) : (
            <Unset>Necompletată</Unset>
          )}
        </FactRow>
        {/* BC and the Moderator set the date tenure counts from (#932); for
            anyone else it is the header's "Membru din", when there is one. */}
        {canEdit && <JoinDateRow member={member} />}
        {/* R58: BC and the Moderator set the university; Profil and the
            Member Card show it to everyone else. */}
        {canEdit && <UniversityRow member={member} />}
        {member.contact?.email && (
          <FactRow label="E-mail">
            <span className="break-all">{member.contact.email}</span>
          </FactRow>
        )}
        {member.contact?.phone && (
          <FactRow label="Telefon">{member.contact.phone}</FactRow>
        )}
        {leads && (
          <FactRow label="Politica de confidențialitate">
            {privacy.isPending
              ? 'Se încarcă…'
              : privacy.isError
                ? '—'
                : acknowledgementLabel(privacy.data)}
          </FactRow>
        )}
      </ul>
      {message && turn.current && (
        <p role="status" className="m-0 text-sm font-medium">
          {message}
        </p>
      )}
      {canEdit && (
        <FormSheet
          open={editing}
          onOpenChange={setEditing}
          title="Nume și poreclă"
          busy={change.isPending}
          finalFocus={editButton}
        >
          {editing && (
            <>
              <IdentityForm
                member={member}
                pending={change.isPending}
                onSave={async (values) => {
                  await change.mutateAsync({
                    memberId: member.memberId,
                    ...values,
                  });
                  setEditing(false);
                  setMessage('Numele a fost actualizat.');
                  turn.claim();
                }}
              />
              <FormSheetFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={change.isPending}
                  onClick={() => setEditing(false)}
                >
                  Renunță
                </Button>
                <Button
                  type="submit"
                  form={IDENTITY_FORM_ID}
                  disabled={change.isPending}
                >
                  {change.isPending ? 'Se salvează…' : 'Salvează numele'}
                </Button>
              </FormSheetFooter>
            </>
          )}
        </FormSheet>
      )}
    </Panel>
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
      <PageHeader title="Membru indisponibil" />
    </Page>
  );
}

function PointsPanel({ points }: { points: readonly LedgerRow[] }) {
  return (
    <Panel title="Istoric puncte" flush={points.length > 0}>
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
 * The Member's Groups the viewer may see, each row a link to the Group's page
 * in Administrare; a Group Role is a chip, a plain membership says nothing
 * the list does not (B60).
 */
function GroupsPanel({
  groups,
  from,
}: {
  groups: readonly MemberCardGroup[];
  /** Sends the Group page's back link here (navigation D4, A63). */
  from: ReturnType<typeof backLinkState>;
}) {
  return (
    // Named, not titled: the tab already says "Grupuri".
    <Panel aria-label="Grupuri" flush={groups.length > 0}>
      {!groups.length ? (
        <Empty text="Nu există grupuri în aria ta de administrare." />
      ) : (
        <ul className={rowListClass}>
          {groups.map((group) => (
            <ListRow
              key={group.id}
              className="relative has-[a:hover]:bg-muted"
              value={
                hasGroupRole(group) ? (
                  <Badge variant="outline">{group.roleLabel}</Badge>
                ) : undefined
              }
              action={
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              }
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor: safeHexColor(
                      group.color,
                      'var(--ink-400)',
                    ),
                  }}
                />
                {/* The whole row opens the Group, in the text colour. */}
                <Link
                  className={`min-w-0 text-sm font-semibold wrap-anywhere text-foreground underline-offset-4 after:absolute after:inset-0 hover:underline ${focusRingAfterClass}`}
                  to={`/administrare/grupuri/${group.id}`}
                  state={from}
                >
                  {group.label}
                </Link>
              </span>
            </ListRow>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * One Member's page in Administrare (#103; ADR-0009 §Management surface),
 * drawn as Profil is: the identity as the page's header — avatar, the name,
 * then one line of role, status, "Membru din …" and email — and under it the
 * same tabs, their choice in the URL (`?tab=`):
 *
 * - **Cont**: the names, the join date, contact details and the Privacy
 *   Acknowledgement, with the invitation to resend while it is pending.
 * - **Grupuri**: the Member's Groups in the viewer's area.
 * - **Roluri**: the Role and status editor and Istoric roluri — a tab only
 *   for whoever may see one of them.
 * - **Puncte**: the ledger rows the viewer may read.
 *
 * Every tab stays mounted, so a draft or a receipt survives a look at
 * another one and the page still shows one receipt at a time.
 *
 * Everything on it is what the server returned for this viewer: the Member
 * Card's Groups (Private Groups already filtered), contact details only when
 * `member_contacts()` answers, and only the ledger rows RLS lets them read.
 * A sub-page of the Membri tab: back link, no tab bar of Administrare (#825).
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
  const [params, setParams] = useSearchParams();
  const tabStrip = useRef<HTMLDivElement>(null);
  const asked = params.get(TAB_KEY);
  useActiveTabInView(tabStrip, asked ?? 'cont');
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
  // role_history_read answers another Member's rows to level 6 only.
  const showTimeline = leads && Boolean(data.role);
  // Roluri is a tab only for whoever has something on it.
  const tabs = MEMBER_TABS.filter(
    (value) => value !== 'roluri' || rights.rankAndStatus || showTimeline,
  );
  const tab: MemberTab = tabs.find((value) => value === asked) ?? 'cont';

  // One receipt at a time on the page: a new command's replaces the last
  // (F-11, the D-16 rule of the Task sheet).
  return (
    // Keyed by Member: opening another one remounts every editor below.
    <ReceiptTurnScope key={data.memberId}>
      <Page>
        <BackToAdministrare capabilities={capabilities.data} />
        {/* The identity is the page's header, as on Profil: the avatar and
            the one `PageHeader` whose title is the Member's name, then one
            line of what they are. */}
        <div data-slot="member-identity" className="grid min-w-0 gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="grid size-12 shrink-0 place-items-center rounded-full text-lg font-bold text-white md:size-14 md:text-xl"
              style={{ backgroundColor: safeHexColor(data.avatarColor) }}
              aria-hidden="true"
            >
              {initials(data.fullName)}
            </div>
            <PageHeader className="min-w-0 flex-1" title={name} />
          </div>
          <div
            data-slot="member-meta"
            className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground"
          >
            {data.roleLabel && (
              <span data-slot="member-role" className="role-badge">
                <span className="role-dot" aria-hidden="true" />
                {data.roleLabel}
              </span>
            )}
            {/* A Board Title names the Role (#963); the rank follows it. */}
            {data.rankLabel && data.rankLabel !== data.roleLabel && (
              <span data-slot="member-rank">{data.rankLabel}</span>
            )}
            {data.status && (
              <span data-slot="member-status">{statusLabel(data.status)}</span>
            )}
            {/* An imported Member who never signed in has no date yet (F-28). */}
            {joined && (
              <span className="flex items-center gap-1.5">
                <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
                <span>Membru din {joined}</span>
              </span>
            )}
            {data.contact?.email && (
              <span className="flex min-w-0 items-center gap-1.5">
                <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="break-all">{data.contact.email}</span>
              </span>
            )}
          </div>
        </div>

        <Tabs.Root
          // The tab strip has no margin of its own: this stack spaces it.
          className="flex flex-col gap-6"
          value={tab}
          onValueChange={(value) => {
            // A tab is not a history entry; the Group pages' way back
            // (`state.from`) is kept.
            setParams(
              { [TAB_KEY]: String(value) },
              { replace: true, state: location.state },
            );
          }}
        >
          <Tabs.List
            ref={tabStrip}
            aria-label="Secțiunile membrului"
            className={tabListClass}
          >
            <Tabs.Indicator className={tabThumbClass} />
            <Tabs.Tab value="cont" className={tabClass}>
              <UserRound aria-hidden="true" />
              Cont
            </Tabs.Tab>
            <Tabs.Tab value="grupuri" className={tabClass}>
              <Users aria-hidden="true" />
              Grupuri
            </Tabs.Tab>
            {tabs.includes('roluri') && (
              <Tabs.Tab value="roluri" className={tabClass}>
                <GraduationCap aria-hidden="true" />
                Roluri
              </Tabs.Tab>
            )}
            <Tabs.Tab value="puncte" className={tabClass}>
              <History aria-hidden="true" />
              Puncte
            </Tabs.Tab>
          </Tabs.List>

          {/* A swipe over the panel moves between the tabs as a tap would (2026-10-11). */}
          <SwipePanels
            order={tabs}
            current={tab}
            onSelect={(value) =>
              setParams(
                { [TAB_KEY]: value },
                { replace: true, state: location.state },
              )
            }
          >
            <Tabs.Panel
              value="cont"
              keepMounted
              className="motion-enter outline-none"
            >
              <div className="grid min-w-0 gap-4 md:grid-cols-2 md:items-start md:gap-6">
                <AccountPanel
                  member={data}
                  canEdit={rights.profile}
                  leads={leads}
                />
                {rights.profile && <ReinvitePanel memberId={data.memberId} />}
              </div>
            </Tabs.Panel>

            <Tabs.Panel
              value="grupuri"
              keepMounted
              className="motion-enter outline-none"
            >
              <GroupsPanel groups={visibleGroups} from={fromHere} />
            </Tabs.Panel>

            {tabs.includes('roluri') && (
              <Tabs.Panel
                value="roluri"
                keepMounted
                className="motion-enter outline-none"
              >
                <div className="flex min-w-0 flex-col gap-4 md:gap-6">
                  {rights.rankAndStatus && (
                    <RolePanel selectedMemberId={data.memberId} />
                  )}
                  {showTimeline && data.role && (
                    <Panel title="Istoric roluri">
                      <MemberRoleTimeline
                        memberId={data.memberId}
                        joinedAt={data.joinedAt}
                        role={data.role}
                      />
                    </Panel>
                  )}
                </div>
              </Tabs.Panel>
            )}

            <Tabs.Panel
              value="puncte"
              keepMounted
              className="motion-enter outline-none"
            >
              <PointsPanel points={data.points} />
            </Tabs.Panel>
          </SwipePanels>
        </Tabs.Root>
      </Page>
    </ReceiptTurnScope>
  );
}
