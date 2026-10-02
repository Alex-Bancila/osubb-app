import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Pause, Play, Send } from 'lucide-react';
import type { ZodType } from 'zod';
import { cn } from 'cn';
import { focusRingClass, SegmentedToggle } from '../../components/layout';
import { Empty, ErrorState, Loading } from '../../components/states';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  NativeSelect,
  NativeSelectOption,
} from '../../components/ui/native-select';
import { ChoiceRow } from '../../components/ui/radio-group';
import { describeFailure, reasonCopy } from '../../lib/command-reasons';
import type { Database } from '../../lib/database.types';
import { bucharestDayKey } from '../../lib/calendar-time';
import { formatDate, formatMemberCount } from '../../lib/format';
import { requiredText } from '../../lib/schemas/text';
import { emailSchema, phoneSchema } from '../../lib/schemas/profile';
import { runGroupCommand } from '../../queries/groups-admin';
import { keys } from '../../queries/keys';
import { changeMember } from '../../queries/member-role-management';
import { useGroups, useRoles, type Group } from '../../queries/reference';
import {
  sendInvitationBatch,
  updateUninvitedContact,
  useUninvitedMembers,
  type ContactField,
  type UninvitedMember,
} from '../../queries/volunteer-import';
import { normalizeSearch } from '../volunteers/directory-filters';
import { planDepartmentChange } from './department-edit';
import { describePlacements } from './placement-labels';
import {
  BATCH_SIZES,
  useInvitationSender,
  type RowSendState,
} from './use-invitation-sender';
import { ProblemChip, ProgressTrack } from './VolunteerImportFlow';
import { useQueryClient } from '@tanstack/react-query';

type MemberRole = Database['public']['Enums']['member_role'];

/** The runbook's "before you send" settings (#991): rate limit, link expiry, Resend. */
export const IMPORT_RUNBOOK_URL =
  'https://github.com/Alex-Bancila/osubb-app/blob/main/docs/ops/volunteer-import-2026-10.md';

const SAVE_FAILED = 'Nu am putut salva schimbarea. Reîncearcă.';

function memberPagePath(memberId: string) {
  return `/administrare/membri/${encodeURIComponent(memberId)}`;
}

/** A schema's first refusal, in the shared copy. */
function check<T>(schema: ZodType<T>, value: string) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { value: parsed.data };
  const reason = parsed.error.issues[0]?.message;
  return { error: reasonCopy(reason) ?? SAVE_FAILED };
}

const nameSchema = requiredText({
  required: 'full_name_required',
  max: 120,
  tooLong: 'full_name_too_long',
});

const FIELDS: Record<
  ContactField,
  {
    label: string;
    type: 'text' | 'email' | 'tel';
    validate: (value: string) => { value: string | null } | { error: string };
  }
> = {
  fullName: {
    label: 'Numele',
    type: 'text',
    validate: (value) => check(nameSchema, value),
  },
  email: {
    label: 'Emailul',
    type: 'email',
    validate: (value) => check(emailSchema, value),
  },
  phone: {
    label: 'Telefonul',
    type: 'tel',
    validate: (value) => check(phoneSchema, value),
  },
};

/** A cell's resting look: its text, a dotted underline on hover, no frame. */
const cellButtonClass = cn(
  'flex min-h-8 w-full items-center rounded-sm px-1.5 text-left decoration-dotted underline-offset-4 hover:bg-muted hover:underline disabled:pointer-events-none',
  focusRingClass,
);

const inputClass =
  'h-8 w-full min-w-0 rounded-sm border border-ring bg-background px-1.5 text-sm outline-none aria-invalid:border-destructive';

/**
 * One editable cell: text at rest, an input on click. Enter or leaving the
 * field saves, Escape puts the text back. A refusal stays under the input
 * with the input still open, so the fix is one keystroke away.
 */
function TextCell({
  field,
  member,
  value,
  onSave,
}: {
  field: ContactField;
  member: UninvitedMember;
  value: string;
  onSave: (value: string | null) => Promise<void>;
}) {
  const spec = FIELDS[field];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cancelled = useRef(false);
  const who = member.name || member.email;

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const result = spec.validate(draft);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    if ((result.value ?? '') === value) {
      setEditing(false);
      setError(null);
      return;
    }
    setSaving(true);
    try {
      await onSave(result.value);
      setEditing(false);
      setError(null);
    } catch (failure) {
      setError(describeFailure(failure, SAVE_FAILED).message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing)
    return (
      <button
        type="button"
        className={cellButtonClass}
        aria-label={`Editează ${spec.label.toLowerCase()} pentru ${who}`}
        onClick={() => {
          cancelled.current = false;
          setDraft(value);
          setError(null);
          setEditing(true);
        }}
      >
        <span>{value || <span className="text-muted-foreground">—</span>}</span>
      </button>
    );
  return (
    <div className="grid gap-0.5">
      <input
        // A cell opened on purpose takes the cursor at once.
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        type={spec.type}
        aria-label={`${spec.label} pentru ${who}`}
        aria-invalid={error ? true : undefined}
        className={inputClass}
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelled.current = true;
            setEditing(false);
            setError(null);
          }
        }}
      />
      {error && (
        <p role="alert" className="text-xs whitespace-normal text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The rank, chosen from the Roles; a change saves at once (`set_member_role`). */
function RankCell({
  member,
  roles,
  onSave,
}: {
  member: UninvitedMember;
  roles: ReadonlyArray<{ id: string; name: string }>;
  onSave: (role: MemberRole) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const label = roles.find((role) => role.id === member.role)?.name ?? '—';
  const who = member.name || member.email;

  if (!editing)
    return (
      <div className="grid gap-0.5">
        <button
          type="button"
          className={cellButtonClass}
          aria-label={`Editează rangul pentru ${who}`}
          onClick={() => {
            setError(null);
            setEditing(true);
          }}
        >
          {label}
        </button>
        {error && (
          <p
            role="alert"
            className="text-xs whitespace-normal text-destructive"
          >
            {error}
          </p>
        )}
      </div>
    );
  return (
    <NativeSelect
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      aria-label={`Rangul pentru ${who}`}
      className="h-8 rounded-sm pl-1.5"
      value={member.role ?? ''}
      disabled={saving}
      onBlur={() => setEditing(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setEditing(false);
      }}
      onChange={(event) => {
        const role = event.target.value as MemberRole;
        setSaving(true);
        onSave(role)
          .then(() => setError(null))
          .catch((failure: unknown) =>
            setError(describeFailure(failure, SAVE_FAILED).message),
          )
          .finally(() => {
            setSaving(false);
            setEditing(false);
          });
      }}
    >
      {member.role === null && (
        <NativeSelectOption value="">—</NativeSelectOption>
      )}
      {roles.map((role) => (
        <NativeSelectOption key={role.id} value={role.id}>
          {role.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/**
 * Departments in one editor: the principal one (the earliest joined, R17)
 * and the others. Saved as Group commands, one by one (`planDepartmentChange`).
 */
function DepartmentsEditor({
  member,
  departments,
  current,
  open,
  onOpenChange,
}: {
  member: UninvitedMember;
  departments: readonly Group[];
  current: readonly UninvitedMember['groups'][number][];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const [principal, setPrincipal] = useState<number | null>(
    current[0]?.groupId ?? null,
  );
  const [others, setOthers] = useState<Set<number>>(
    () => new Set(current.slice(1).map((row) => row.groupId)),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const who = member.name || member.email;

  async function save() {
    const plan = planDepartmentChange(member.memberId, current, principal, [
      ...others,
    ]);
    if (plan.kind === 'blocked') {
      const name = departments.find((group) => group.id === plan.groupId)?.name;
      setError(
        `${who} are o funcție în ${name ?? 'acest departament'}. Schimbă departamentul principal din pagina membrului.`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      for (const command of plan.commands) await runGroupCommand(command);
      onOpenChange(false);
    } catch (failure) {
      setError(describeFailure(failure, SAVE_FAILED).message);
    } finally {
      setSaving(false);
      await Promise.all(
        [keys.members.all, keys.groups.all].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Departamente</DialogTitle>
          <DialogDescription>
            {who}. Departamentul principal apare pe cardul membrului.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-sm font-medium">
          Departament principal
          <NativeSelect
            value={principal === null ? '' : String(principal)}
            disabled={saving}
            onChange={(event) => {
              const next = event.target.value
                ? Number(event.target.value)
                : null;
              setPrincipal(next);
              setOthers((set) => {
                const copy = new Set(set);
                if (next !== null) copy.delete(next);
                return copy;
              });
            }}
          >
            <NativeSelectOption value="">Niciunul</NativeSelectOption>
            {departments.map((group) => (
              <NativeSelectOption key={group.id} value={group.id}>
                {group.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <fieldset className="grid" disabled={principal === null || saving}>
          <legend className="mb-1 text-sm font-medium">
            Alte departamente
          </legend>
          {departments
            .filter((group) => group.id !== principal)
            .map((group) => (
              <ChoiceRow key={group.id}>
                <Checkbox
                  checked={others.has(group.id)}
                  disabled={principal === null || saving}
                  onCheckedChange={(checked) =>
                    setOthers((set) => {
                      const copy = new Set(set);
                      if (checked) copy.add(group.id);
                      else copy.delete(group.id);
                      return copy;
                    })
                  }
                />
                {group.name}
              </ChoiceRow>
            ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Renunță
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? 'Se salvează…' : 'Salvează'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentsCell({
  member,
  groups,
  departments,
}: {
  member: UninvitedMember;
  groups: ReadonlyMap<number, Group>;
  departments: readonly Group[];
}) {
  const [open, setOpen] = useState(false);
  const current = member.groups.filter(
    (row) => groups.get(row.groupId)?.category === 'department',
  );
  const [first, ...rest] = current.map(
    (row) => groups.get(row.groupId)?.name ?? row.groupName,
  );
  const who = member.name || member.email;
  return (
    <>
      <button
        type="button"
        className={cellButtonClass}
        aria-label={`Editează departamentele pentru ${who}`}
        onClick={() => setOpen(true)}
      >
        {first ? (
          <span>
            <span className="font-medium">{first}</span>
            {rest.length > 0 && (
              <span className="text-muted-foreground">, {rest.join(', ')}</span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </button>
      {open && (
        <DepartmentsEditor
          member={member}
          departments={departments}
          current={current}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}

const SEND_LABEL: Record<RowSendState['status'], string> = {
  pending: 'în așteptare',
  sending: 'se trimite…',
  sent: 'trimis',
  error: 'eroare',
  rate_limited: 'limită atinsă',
  skipped: 'sărit',
};

function SendCell({ state }: { state: RowSendState | undefined }) {
  if (!state) return null;
  if (state.status === 'sent')
    return (
      <span className="inline-flex h-5 items-center rounded-4xl border border-border px-2 text-xs font-medium whitespace-nowrap">
        Invitație trimisă · {formatDate(bucharestDayKey(state.invitedAt))}
      </span>
    );
  return (
    <span
      title={
        state.status === 'error' || state.status === 'skipped'
          ? state.message
          : undefined
      }
      className={cn(
        'text-xs font-medium whitespace-nowrap',
        state.status === 'error' && 'text-destructive',
        state.status === 'rate_limited' && 'text-(--warning)',
        (state.status === 'pending' || state.status === 'sending') &&
          'text-muted-foreground',
      )}
    >
      {SEND_LABEL[state.status]}
      {(state.status === 'error' || state.status === 'skipped') && (
        <span className="sr-only">: {state.message}</span>
      )}
    </span>
  );
}

const th =
  'px-2 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground bg-card shadow-[inset_0_-1px_0_var(--border)]';
const td = 'px-1 py-1 align-middle whitespace-nowrap';
/** The first two columns stay put while the grid scrolls sideways (phones). */
const stickyCheck = 'sticky left-0 z-[1] w-10 bg-card pl-2';
const stickyName =
  'sticky left-10 z-[1] bg-card shadow-[inset_-1px_0_0_var(--border)] max-sm:max-w-40 max-sm:whitespace-normal';

type RowFilter = 'all' | 'problems';

function SenderBar({
  sender,
  count,
  selectedCount,
  onStart,
}: {
  sender: ReturnType<typeof useInvitationSender>;
  count: number;
  selectedCount: number;
  onStart: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const target = selectedCount > 0 ? selectedCount : count;
  const busy = sender.status === 'sending';
  const stopped =
    sender.status === 'paused' || sender.status === 'rate_limited';

  return (
    <section
      aria-label="Trimiterea invitațiilor"
      className="flex flex-col gap-3 rounded-md border border-l-4 border-border border-l-(--warning) bg-(--surface-2) p-3"
    >
      {/* The runbook's banner (#991): the dashboard settings come first. */}
      <p role="note" className="text-sm">
        Înainte de prima trimitere, verifică în Supabase setările din runbook:
        limita de emailuri pe oră (Auth → Rate limits), expirarea linkului și
        domeniul Resend.{' '}
        <a
          href={IMPORT_RUNBOOK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'font-medium underline underline-offset-4',
            focusRingClass,
          )}
        >
          Deschide runbook-ul
        </a>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Mărimea lotului
          <NativeSelect
            wrapperClassName="w-24"
            value={String(sender.batchSize)}
            disabled={busy}
            onChange={(event) =>
              sender.setBatchSize(Number(event.target.value))
            }
          >
            {BATCH_SIZES.map((size) => (
              <NativeSelectOption key={size} value={size}>
                {size}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {busy ? (
          <Button
            type="button"
            variant="outline"
            disabled={sender.pausing}
            onClick={sender.pause}
          >
            <Pause aria-hidden="true" />
            {sender.pausing ? 'Se oprește după lot…' : 'Pune pe pauză'}
          </Button>
        ) : stopped && sender.left > 0 ? (
          <Button type="button" onClick={sender.resume}>
            <Play aria-hidden="true" />
            Reia ({sender.left})
          </Button>
        ) : confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              Trimiți {target === 1 ? 'o invitație' : `${target} invitații`},
              câte {sender.batchSize} pe lot?
            </span>
            <Button
              type="button"
              onClick={() => {
                setConfirming(false);
                onStart();
              }}
            >
              <Send aria-hidden="true" />
              Trimite
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
            >
              Renunță
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            disabled={target === 0}
            onClick={() => setConfirming(true)}
          >
            <Send aria-hidden="true" />
            Trimite invitațiile ({target})
          </Button>
        )}
      </div>
      {sender.total > 0 && (
        <div className="grid gap-1.5" aria-live="polite">
          <ProgressTrack
            label="Progresul trimiterii"
            done={sender.sent + sender.failed + sender.skipped}
            total={sender.total}
          />
          <p className="text-sm tabular-nums">
            {sender.sent} trimise din {sender.total}
            {sender.failed > 0 && ` · ${sender.failed} cu eroare`}
            {sender.skipped > 0 && ` · ${sender.skipped} sărite`}
            {sender.status === 'done' && ' · gata'}
            {sender.status === 'paused' && ' · pe pauză'}
          </p>
          {sender.status === 'rate_limited' && (
            <p role="alert" className="text-sm">
              Limita de emailuri pe oră a fost atinsă. Trimiterea s-a oprit;
              apasă „Reia” după ce limita se resetează.
            </p>
          )}
          {sender.failure && (
            <p role="alert" className="text-sm text-destructive">
              {sender.failure}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * "De invitat" (#992): the Members the volunteer import created that nobody
 * has invited and who never signed in (#991's read), as a working grid —
 * name, email, phone, rank and Departments edit in place through the commands
 * the member page uses; positions and the import's problems are read-only,
 * with the member page one click away for the rest. "Trimite invitațiile"
 * sends to the ticked rows, or to everyone listed, in batches. A Member sent
 * in this visit keeps the row with "Invitație trimisă" and its date; the list
 * drops them on the next load.
 */
export function UninvitedGrid() {
  const client = useQueryClient();
  const members = useUninvitedMembers();
  const groups = useGroups();
  const roles = useRoles();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RowFilter>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /** Rows sent in this visit, kept as they were when sent. */
  const [sentRows, setSentRows] = useState<
    ReadonlyMap<string, UninvitedMember>
  >(() => new Map());

  const sender = useInvitationSender(async (ids) => {
    const result = await sendInvitationBatch(ids);
    const sent = new Set(
      result.results
        .filter((row) => row.status === 'sent')
        .map((row) => row.memberId),
    );
    if (sent.size > 0) {
      setSentRows((current) => {
        const next = new Map(current);
        for (const member of members.data ?? [])
          if (sent.has(member.memberId)) next.set(member.memberId, member);
        return next;
      });
      setSelected((current) => {
        const next = new Set(current);
        for (const id of sent) next.delete(id);
        return next;
      });
      // The sent leave the read (`invited_at` is stamped); this list keeps
      // them from `sentRows`, and the "De invitat (N)" count follows.
      void client.invalidateQueries({ queryKey: keys.members.all });
    }
    return result;
  });

  const groupMap = groups.data ?? new Map<number, Group>();
  const departments = useMemo(
    () =>
      [...(groups.data?.values() ?? [])]
        .filter(
          (group) =>
            group.category === 'department' &&
            group.status === 'active' &&
            !group.is_organization,
        )
        .sort((left, right) => left.name.localeCompare(right.name, 'ro')),
    [groups.data],
  );
  // The Moderator is a system seat, never an imported volunteer's rank.
  const roleOptions = useMemo(
    () =>
      [...(roles.data?.entries() ?? [])]
        .filter(([id]) => id !== 'moderator')
        .sort(([, left], [, right]) => left.level - right.level)
        .map(([id, role]) => ({ id, name: role.name })),
    [roles.data],
  );

  const waiting = useMemo(
    () =>
      (members.data ?? []).filter((member) => !sentRows.has(member.memberId)),
    [members.data, sentRows],
  );
  const withProblems = waiting.filter(
    (member) => member.problems.length > 0,
  ).length;
  // Once the last row with problems is sent the toggle goes away: show all.
  const rowFilter: RowFilter = withProblems > 0 ? filter : 'all';
  const shown = useMemo(() => {
    const needle = normalizeSearch(query.trim());
    const rows = [...waiting, ...sentRows.values()].filter(
      (member) =>
        (rowFilter === 'all' ||
          (!sentRows.has(member.memberId) && member.problems.length > 0)) &&
        (!needle ||
          normalizeSearch(`${member.name} ${member.email}`).includes(needle)),
    );
    return rows.sort(
      (left, right) =>
        Number(sentRows.has(left.memberId)) -
          Number(sentRows.has(right.memberId)) ||
        left.name.localeCompare(right.name, 'ro'),
    );
  }, [waiting, sentRows, query, rowFilter]);
  const selectable = shown.filter((member) => !sentRows.has(member.memberId));
  const allSelected =
    selectable.length > 0 &&
    selectable.every((member) => selected.has(member.memberId));
  const someSelected = selectable.some((member) =>
    selected.has(member.memberId),
  );
  async function saveContact(
    member: UninvitedMember,
    field: ContactField,
    value: string | null,
  ) {
    await updateUninvitedContact({ memberId: member.memberId, field, value });
    await client.invalidateQueries({ queryKey: keys.members.all });
  }

  async function saveRank(member: UninvitedMember, role: MemberRole) {
    await changeMember({
      kind: 'role',
      memberId: member.memberId,
      role,
      reason: 'Corectat la importul bazei de voluntari',
    });
    await Promise.all(
      [keys.members.all, keys.groups.all].map((queryKey) =>
        client.invalidateQueries({ queryKey }),
      ),
    );
  }

  function startSending() {
    const ids =
      selected.size > 0
        ? waiting
            .filter((member) => selected.has(member.memberId))
            .map((member) => member.memberId)
        : waiting.map((member) => member.memberId);
    sender.start(ids);
  }

  if (members.isPending)
    return <Loading label="Se încarcă lista „De invitat”…" />;
  if (members.isError)
    return (
      <ErrorState
        text="Nu am putut încărca lista „De invitat”."
        onRetry={() => void members.refetch()}
      />
    );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SenderBar
        sender={sender}
        count={waiting.length}
        selectedCount={[...selected].filter((id) => !sentRows.has(id)).length}
        onStart={startSending}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid w-full gap-1 text-sm sm:max-w-sm">
          Caută după nume sau email
          <input
            type="search"
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {withProblems > 0 && (
          <SegmentedToggle
            label="Rânduri afișate"
            value={rowFilter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `Toți (${waiting.length})` },
              { value: 'problems', label: `Cu probleme (${withProblems})` },
            ]}
          />
        )}
      </div>

      {waiting.length === 0 && sentRows.size === 0 ? (
        <Empty text="Nu e nimeni de invitat. Membrii importați apar aici până primesc invitația." />
      ) : (
        <div
          className="max-h-[70dvh] scroll-pl-[12.5rem] overflow-auto sm:scroll-pl-[16rem] rounded-md border border-border"
          role="region"
          aria-label="Membri de invitat"
          tabIndex={0}
        >
          <table className="w-full min-w-[68rem] text-sm">
            <thead className="sticky top-0 z-[2]">
              <tr>
                <th scope="col" className={cn(th, stickyCheck)}>
                  <Checkbox
                    aria-label="Selectează toți membrii afișați"
                    checked={allSelected}
                    indeterminate={!allSelected && someSelected}
                    disabled={selectable.length === 0}
                    onCheckedChange={(checked) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        for (const member of selectable)
                          if (checked) next.add(member.memberId);
                          else next.delete(member.memberId);
                        return next;
                      })
                    }
                  />
                </th>
                <th
                  scope="col"
                  className={cn(
                    th,
                    stickyName,
                    'min-w-36 sm:min-w-48 shadow-[inset_-1px_-1px_0_var(--border)]',
                  )}
                >
                  Nume
                </th>
                <th scope="col" className={cn(th, 'min-w-56')}>
                  Email
                </th>
                <th scope="col" className={cn(th, 'min-w-36')}>
                  Telefon
                </th>
                <th scope="col" className={cn(th, 'min-w-52')}>
                  Rang
                </th>
                <th scope="col" className={cn(th, 'min-w-48')}>
                  Departamente
                </th>
                <th scope="col" className={cn(th, 'min-w-44')}>
                  Funcție
                </th>
                <th scope="col" className={cn(th, 'min-w-40')}>
                  Probleme
                </th>
                <th scope="col" className={th}>
                  Trimitere
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">Pagina membrului</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((member) => {
                const done = sentRows.has(member.memberId);
                const who = member.name || member.email;
                return (
                  <tr
                    key={member.memberId}
                    className={cn(
                      'border-b border-border last:border-0',
                      done && 'text-muted-foreground',
                    )}
                  >
                    <td className={cn(td, stickyCheck)}>
                      {!done && (
                        <Checkbox
                          aria-label={`Selectează ${who}`}
                          className="align-middle"
                          checked={selected.has(member.memberId)}
                          onCheckedChange={(checked) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (checked) next.add(member.memberId);
                              else next.delete(member.memberId);
                              return next;
                            })
                          }
                        />
                      )}
                    </td>
                    <Cell
                      className={stickyName}
                      done={done}
                      text={member.name}
                      sent={
                        <MemberName
                          memberId={member.memberId}
                          fullName={member.name}
                          size="sm"
                        />
                      }
                    >
                      <TextCell
                        field="fullName"
                        member={member}
                        value={member.name}
                        onSave={(value) =>
                          saveContact(member, 'fullName', value)
                        }
                      />
                    </Cell>
                    {/* `send-invitations` mails the Profile's address and
                        moves Auth there first, so a correction made here is
                        where the invitation goes. */}
                    <Cell done={done} text={member.email}>
                      <TextCell
                        field="email"
                        member={member}
                        value={member.email}
                        onSave={(value) => saveContact(member, 'email', value)}
                      />
                    </Cell>
                    <Cell done={done} text={member.phone ?? '—'}>
                      <TextCell
                        field="phone"
                        member={member}
                        value={member.phone ?? ''}
                        onSave={(value) => saveContact(member, 'phone', value)}
                      />
                    </Cell>
                    <Cell
                      done={done}
                      text={
                        roleOptions.find((role) => role.id === member.role)
                          ?.name ?? '—'
                      }
                    >
                      <RankCell
                        member={member}
                        roles={roleOptions}
                        onSave={(role) => saveRank(member, role)}
                      />
                    </Cell>
                    <td className={td}>
                      {done ? null : (
                        <DepartmentsCell
                          member={member}
                          groups={groupMap}
                          departments={departments}
                        />
                      )}
                    </td>
                    <td className={cn(td, 'px-2')}>
                      {describePlacements(
                        member.groups,
                        groupMap,
                      ).positions.join('; ') || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={cn(td, 'px-2')}>
                      <span className="flex flex-wrap gap-1">
                        {member.problems.map((problem, index) => (
                          <ProblemChip key={index} problem={problem} />
                        ))}
                      </span>
                    </td>
                    <td className={cn(td, 'px-2')}>
                      <SendCell state={sender.rows.get(member.memberId)} />
                    </td>
                    <td className={td}>
                      <Link
                        to={memberPagePath(member.memberId)}
                        aria-label={`Deschide pagina membrului ${who}`}
                        className={cn(
                          'inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground',
                          focusRingClass,
                        )}
                      >
                        <ArrowUpRight aria-hidden="true" className="size-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-6 text-center text-muted-foreground"
                  >
                    Niciun membru nu se potrivește căutării.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {formatMemberCount(waiting.length)} de invitat
        {sentRows.size > 0 && ` · ${sentRows.size} trimise acum`}
      </p>
    </div>
  );
}

/** A cell that edits while the row waits, and only reads once it was sent. */
function Cell({
  done,
  text,
  sent,
  className,
  children,
}: {
  done: boolean;
  text: string;
  /** What a sent row shows instead of `text` (the name, as `MemberName`). */
  sent?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  if (done && sent)
    return (
      <td className={cn(td, className)}>
        <span className="block px-1.5 py-2">{sent}</span>
      </td>
    );
  return (
    <td className={cn(td, className)}>
      {done ? (
        <span className="block px-1.5 py-2">{text || '—'}</span>
      ) : (
        children
      )}
    </td>
  );
}
