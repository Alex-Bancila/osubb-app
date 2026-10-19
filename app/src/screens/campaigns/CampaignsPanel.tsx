import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router';
import {
  ChevronDown,
  Pencil,
  PlusIcon,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';
import { cn } from 'cn';
import {
  EmptyState,
  FabAction,
  Panel,
  panelBoxClass,
  rowListClass,
  SegmentedToggle,
} from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { ErrorState, Loading } from '../../components/states';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { InfoHint } from '../../components/ui/info-hint';
import { Input } from '../../components/ui/input';
import { ActionMenu } from '../../components/ui/menu';
import { bucharestDayKey } from '../../lib/calendar-time';
import { describeFailure } from '../../lib/command-reasons';
import { formatDay, formatPoints } from '../../lib/format';
import { pointsSinceText } from '../../lib/points-period';
import { campaignSchema, fieldForReason } from '../../lib/schemas/campaign';
import { useFormValidation } from '../../lib/use-form-validation';
import { usePointsStartDate } from '../../queries/evaluation-settings';
import {
  useCampaignChange,
  useCampaignReport,
  useCampaigns,
  type Campaign,
  type CampaignChange,
  type CampaignReportRange,
} from '../../queries/campaigns';
import { CampaignDeleteDialog } from './CampaignDeleteDialog';
import {
  CAMPAIGN_STATE_KEY,
  subtreeCampaigns,
  type CampaignOwnerGroup,
  type CampaignState,
} from './campaign-list';

const SAVE_FAILED = 'Nu am putut salva campania. Reîncearcă.';

/**
 * A small pop-up that asks for one Campaign name: used to create and to
 * rename. Whoever opens it owns `open` (the page's plus button, a row's
 * menu). The name is checked on blur and on save (3–120 characters, ruling
 * R8); a refused save keeps the pop-up and the typed name, with the reason
 * under the field. What the title cannot say (the owning Group) sits behind
 * the "i" beside the label.
 */
function CampaignNameDialog({
  open,
  onOpenChange,
  finalFocus,
  ...form
}: CampaignNameFormProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes on closing, when not back to what opened it. */
  finalFocus?: () => HTMLElement | null;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!form.disabled) onOpenChange(next);
      }}
    >
      <DialogContent finalFocus={finalFocus && (() => finalFocus() ?? true)}>
        {/* The popup unmounts once closed, so each opening starts afresh. */}
        <CampaignNameForm {...form} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

type CampaignNameFormProps = {
  title: string;
  /** What the reader cannot tell from the title (the owning Group). */
  description?: string;
  label: string;
  submitLabel: string;
  initialName: string;
  disabled: boolean;
  /** Runs the command; rejects with the refusal. */
  onSave: (name: string) => Promise<void>;
};

function CampaignNameForm({
  title,
  description,
  label,
  submitLabel,
  initialName,
  disabled,
  onSave,
  onClose,
}: CampaignNameFormProps & { onClose: () => void }) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const [name, setName] = useState(initialName);
  const form = useFormValidation(campaignSchema, { name }, fieldForReason);
  // Renaming to the same name is not a change; nothing to send.
  const unchanged = initialName !== '' && name.trim() === initialName.trim();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (unchanged) return;
    const values = form.validate();
    if (!values) return;
    try {
      await onSave(values.name);
      onClose();
    } catch (failure) {
      form.fail(failure, SAVE_FAILED);
    }
  }
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={inputId} className="text-sm font-medium">
            {label}
          </label>
          {description && (
            <InfoHint label="Despre campanie" id={hintId}>
              {description}
            </InfoHint>
          )}
        </div>
        <Input
          id={inputId}
          value={name}
          required
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
          {...form.field('name', description ? hintId : undefined)}
        />
        <FieldError {...form.errorProps('name')} />
      </div>
      <FieldError>{form.formError}</FieldError>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={onClose}
        >
          Renunță
        </Button>
        <Button type="submit" disabled={disabled || unchanged}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * What a Campaign is worth and who earned it (#625). Mounted only while the
 * report is open, so a panel of ten Campaigns is not ten reads — and it is a
 * report, never a roster: nobody belongs to a Campaign.
 */
function CampaignReportView({
  campaignId,
  range,
}: {
  campaignId: number;
  range: CampaignReportRange | null;
}) {
  const report = useCampaignReport(campaignId, range);
  const pointsStartDate = usePointsStartDate();
  if (range === null)
    return (
      <p className="text-sm text-muted-foreground">
        Corectează perioada din filtre ca să vezi raportul.
      </p>
    );
  if (report.isPending)
    return (
      <p className="text-sm text-muted-foreground">Se încarcă raportul…</p>
    );
  if (report.isError || !report.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        Nu am putut încărca raportul campaniei.
      </p>
    );
  const { totals, members } = report.data;
  const dated = range.p_from !== undefined || range.p_to !== undefined;
  // Ruling 19 (R58): the server floors a report at the Points Start Date, so
  // the report says from when it counts — once the date is known to exist and
  // the chosen period does not already begin after it.
  const startDay = typeof pointsStartDate === 'string' ? pointsStartDate : null;
  const fromDay = range.p_from ? bucharestDayKey(range.p_from) : null;
  const floored = startDay !== null && (fromDay === null || fromDay < startDay);
  const since = floored ? pointsSinceText(startDay) : null;
  return (
    <div className="space-y-2">
      {(dated || since) && (
        <p className="text-sm text-muted-foreground">
          {dated
            ? `Doar punctele acordate în perioada aleasă${since ? `, dar nu înainte de ${formatDay(startDay)}` : ''}.`
            : `Doar punctele acordate ${since}.`}
        </p>
      )}
      <p className="text-sm">
        <span className="font-semibold">{formatPoints(totals.points)}</span>{' '}
        puncte · {totals.tasksCompleted} din {totals.tasksTotal} taskuri
        finalizate
      </p>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {dated
            ? 'Nimeni nu a primit puncte în această campanie în perioada aleasă.'
            : startDay
              ? `Niciun punct acordat de la ${formatDay(startDay)} în această campanie.`
              : 'Nimeni nu a primit încă puncte în această campanie.'}
        </p>
      ) : (
        <ul className="space-y-1 text-sm" aria-label="Voluntari cu puncte">
          {members.map((member) => (
            <li
              key={member.memberId}
              className="flex items-center justify-between gap-3"
            >
              <MemberName
                size="sm"
                memberId={member.memberId}
                nickname={member.nickname}
                fullName={member.name}
              />
              <span className="shrink-0 tabular-nums">
                {formatPoints(member.points)} p · {member.tasksCompleted}{' '}
                taskuri
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One Campaign: the row is the Campaign — its name, its owner under it — and
 * activating it opens the report beneath. Everything that changes it sits
 * behind one "⋯": Redenumește, Dezactivează or Activează, and Șterge definitiv
 * (#1017) last, for the same managers.
 */
function CampaignRow({
  campaign,
  owner,
  range,
  onRun,
  onToggle,
  onDeleted,
  disabled,
  readOnly,
  viewOnly,
}: {
  campaign: Campaign;
  /** The owning Group's name. */
  owner: string;
  range: CampaignReportRange | null;
  /** Runs a change and rejects with its refusal (the rename pop-up shows it). */
  onRun: (change: CampaignChange) => Promise<void>;
  /** Runs a change and shows a refusal above the list. */
  onToggle: (change: CampaignChange) => Promise<void>;
  /** The Campaign was deleted for good: the panel shows this receipt. */
  onDeleted: (receipt: string) => void;
  disabled: boolean;
  /** Only the report: an archived Group changes nothing (Audit D-10). */
  readOnly: boolean;
  /** Neither change nor report: the caller does not manage the owner (#908). */
  viewOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const reportId = useId();
  const row = useRef<HTMLLIElement>(null);
  // Both pop-ups open from the menu, so its "⋯" takes focus back.
  const menuButton = () =>
    row.current?.querySelector<HTMLElement>('[data-slot="action-menu"]') ??
    null;
  const changes = !viewOnly && !readOnly;
  const text = (
    <span className="grid min-w-0 gap-0.5">
      <span className="font-medium break-words">{campaign.name}</span>
      <span className="text-sm text-muted-foreground">Grup: {owner}</span>
    </span>
  );
  return (
    <li ref={row} data-slot="campaign-row">
      <div
        className={cn(
          'relative flex min-h-14 items-center gap-2 px-4 py-2',
          !viewOnly && 'hover:bg-muted/40',
        )}
      >
        {viewOnly ? (
          <div className="min-w-0 flex-1">{text}</div>
        ) : (
          // The whole row is the button (`after:inset-0`); the menu sits
          // above it.
          <button
            type="button"
            aria-expanded={open}
            aria-controls={reportId}
            className="flex min-w-0 flex-1 cursor-pointer items-center text-left outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring focus-visible:after:outline-solid"
            onClick={() => setOpen((current) => !current)}
          >
            {text}
            <span className="sr-only">, raport</span>
          </button>
        )}
        {changes && (
          <ActionMenu
            label={`Acțiuni pentru ${campaign.name}`}
            className="relative z-1"
            items={[
              {
                label: 'Redenumește',
                icon: Pencil,
                disabled,
                onSelect: () => setRenaming(true),
              },
              {
                label: campaign.is_active ? 'Dezactivează' : 'Activează',
                icon: campaign.is_active ? PowerOff : Power,
                disabled,
                onSelect: () =>
                  void onToggle({
                    kind: 'active',
                    id: campaign.id,
                    active: !campaign.is_active,
                  }),
              },
              {
                label: 'Șterge definitiv',
                icon: Trash2,
                destructive: true,
                disabled,
                onSelect: () => setDeleting(true),
              },
            ]}
          />
        )}
        {!viewOnly && (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'pointer-events-none size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        )}
      </div>
      {open && (
        <div id={reportId} className="px-4 pt-1 pb-3">
          <CampaignReportView campaignId={campaign.id} range={range} />
        </div>
      )}
      {changes && (
        <>
          <CampaignNameDialog
            open={renaming}
            onOpenChange={setRenaming}
            finalFocus={menuButton}
            title="Redenumește campania"
            label="Numele campaniei"
            submitLabel="Salvează"
            initialName={campaign.name}
            disabled={disabled}
            onSave={(name) => onRun({ kind: 'rename', id: campaign.id, name })}
          />
          <CampaignDeleteDialog
            campaign={campaign}
            disabled={disabled}
            onDeleted={onDeleted}
            open={deleting}
            onOpenChange={setDeleting}
            returnFocus={menuButton}
          />
        </>
      )}
    </li>
  );
}

/**
 * The Campaigns of one Group and every Group below it, each naming its owner —
 * or, with no Group, every Campaign the caller may read (#908):
 * create (in the Group itself, from the page's plus button), rename,
 * activate, and the report behind each row. Shared by the Campanii screen
 * (which picks the Group through the Work Filter and passes its date range)
 * and the Campanii tab of a Group in Administrare, so there is exactly one of
 * these. It has no heading of its own — the page or the tab already says
 * Campanii — and is named by `label`. The Active / Inactive toggle lives in
 * the URL (`?stare=inactive`); the server decides who may change a row
 * (`campaign_manage_forbidden`), and its refusal is shown.
 */
export function CampaignsPanel({
  group,
  label,
  groups,
  range = {},
  readOnly = false,
  manages = () => true,
  stateSlot,
}: {
  /** The chosen Group; absent lists every readable Campaign, with no create. */
  group?: { id: number; name: string };
  /** The panel's accessible name: the Group shown, or "Toate grupurile". */
  label: string;
  /** Groups with their paths: the owners of the listed Campaigns and their names. */
  groups: readonly CampaignOwnerGroup[];
  /** The report's range; `null` while the page's range is inverted. */
  range?: CampaignReportRange | null;
  /** An archived Group's Campaigns: reports only, no change (Audit D-10). */
  readOnly?: boolean;
  /**
   * Whether the caller manages a Campaign's owner. Any member reads every
   * Campaign, but only its owner's managers change it or read its report
   * (`campaign_report_forbidden`), so the others are listed by name only.
   */
  manages?: (groupId: number) => boolean;
  /**
   * Where the Active / Inactive toggle is drawn instead of above the list (the
   * page header's row); `null` until that element mounts.
   */
  stateSlot?: HTMLElement | null;
}) {
  const campaigns = useCampaigns();
  const mutation = useCampaignChange();
  const [searchParams, setSearchParams] = useSearchParams();
  const state: CampaignState =
    searchParams.get(CAMPAIGN_STATE_KEY) === 'inactive' ? 'inactive' : 'active';
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const submitting = useRef(false);

  /** One change at a time; a refusal is thrown to whoever asked. */
  async function run(change: CampaignChange) {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    setMessage(null);
    try {
      await mutation.mutateAsync(change);
      setMessage(
        change.kind === 'create'
          ? 'Campania a fost creată.'
          : change.kind === 'rename'
            ? 'Numele campaniei a fost actualizat.'
            : change.active
              ? 'Campania a fost activată.'
              : 'Campania a fost dezactivată. Taskurile existente păstrează campania.',
      );
    } finally {
      submitting.current = false;
    }
  }

  async function toggle(change: CampaignChange) {
    try {
      await run(change);
    } catch (failure) {
      // A `CampaignError` is already translated; `describeFailure` keeps its
      // copy (the server's `campaign_manage_forbidden` among them).
      setError(describeFailure(failure, SAVE_FAILED).message);
    }
  }

  function show(next: CampaignState) {
    setMessage(null);
    setError(null);
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === 'inactive') params.set(CAMPAIGN_STATE_KEY, 'inactive');
        else params.delete(CAMPAIGN_STATE_KEY);
        return params;
      },
      { replace: true },
    );
  }

  const names = useMemo(
    () => new Map(groups.map((row) => [row.id, row.name])),
    [groups],
  );
  // The server refuses any change to an archived Group's Campaign
  // (can_manage_group_work reads the owner's status): report only.
  const archived = useMemo(
    () =>
      new Set(
        groups
          .filter((row) => row.status !== undefined && row.status !== 'active')
          .map((row) => row.id),
      ),
    [groups],
  );
  const listed = useMemo(
    () =>
      subtreeCampaigns(campaigns.data ?? [], groups, group?.id).filter(
        (campaign) => campaign.is_active === (state === 'active'),
      ),
    [campaigns.data, groups, group?.id, state],
  );
  const stateToggle = (
    <SegmentedToggle
      label="Stare"
      value={state}
      onChange={show}
      options={[
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
      ]}
    />
  );
  return (
    <Panel aria-label={label} bare stack={3}>
      {stateSlot && createPortal(stateToggle, stateSlot)}
      {/* Empty on a page that draws both elsewhere: the toggle in its header,
          Campanie nouă as its plus button. */}
      <div className="flex flex-wrap items-center justify-between gap-2 empty:hidden">
        {stateSlot === undefined && stateToggle}
        {group && !readOnly && (
          <FabAction
            label="Campanie nouă"
            icon={PlusIcon}
            onSelect={() => setCreating(true)}
          />
        )}
      </div>
      {group && !readOnly && (
        <CampaignNameDialog
          open={creating}
          onOpenChange={setCreating}
          title="Campanie nouă"
          description={`Campania aparține grupului ${group.name} și etichetează taskurile lui și ale subgrupurilor lui.`}
          label="Numele campaniei"
          submitLabel="Creează"
          initialName=""
          disabled={mutation.isPending}
          onSave={(name) => run({ kind: 'create', groupId: group.id, name })}
        />
      )}
      {message && (
        <p role="status" className="m-0">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-destructive">
          {error}
        </p>
      )}
      {campaigns.isPending ? (
        <Loading label="Se încarcă campaniile…" />
      ) : campaigns.isError ? (
        <ErrorState
          error={campaigns.error}
          text="Nu am putut încărca campaniile."
          retryLabel="Reîncearcă"
          onRetry={() => void campaigns.refetch()}
        />
      ) : listed.length ? (
        <ul
          className={cn(panelBoxClass, rowListClass, 'overflow-hidden p-0')}
          aria-label={
            state === 'active' ? 'Campanii active' : 'Campanii inactive'
          }
        >
          {listed.map((campaign) => (
            <CampaignRow
              key={`${campaign.id}:${campaign.name}`}
              campaign={campaign}
              owner={
                names.get(campaign.group_id) ??
                (campaign.group_id === group?.id ? group.name : 'Grup')
              }
              range={range}
              onRun={run}
              onToggle={toggle}
              onDeleted={(receipt) => {
                setError(null);
                setMessage(receipt);
              }}
              disabled={mutation.isPending}
              readOnly={readOnly || archived.has(campaign.group_id)}
              viewOnly={!manages(campaign.group_id)}
            />
          ))}
        </ul>
      ) : (
        <EmptyState bare>
          {`Nicio campanie ${state === 'active' ? 'activă' : 'inactivă'}${
            group ? ' în acest grup sau în subgrupurile lui' : ''
          }.`}
        </EmptyState>
      )}
      {/* How a Campaign comes to be, said once and quietly. */}
      {!group && (
        <p className="m-0 text-xs text-muted-foreground">
          O campanie etichetează taskurile unui grup și ale subgrupurilor lui.
          Alege un grup din filtre ca să creezi una.
        </p>
      )}
    </Panel>
  );
}
