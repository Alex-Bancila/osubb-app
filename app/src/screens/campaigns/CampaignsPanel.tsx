import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { cn } from 'cn';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { describeFailure } from '../../lib/command-reasons';
import { formatPoints } from '../../lib/format';
import { campaignSchema, fieldForReason } from '../../lib/schemas/campaign';
import { useFormValidation } from '../../lib/use-form-validation';
import {
  useCampaignChange,
  useCampaignReport,
  useCampaigns,
  type Campaign,
  type CampaignChange,
  type CampaignReportRange,
} from '../../queries/campaigns';
import {
  CAMPAIGN_STATE_KEY,
  subtreeCampaigns,
  type CampaignOwnerGroup,
  type CampaignState,
} from './campaign-list';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
const SAVE_FAILED = 'Nu am putut salva campania. Reîncearcă.';

/**
 * A small pop-up that asks for one Campaign name: used to create and to
 * rename. The name is checked on blur and on save (3–120 characters, ruling
 * R8); a refused save keeps the pop-up and the typed name, with the reason
 * under the field.
 */
function CampaignNameDialog({
  title,
  label,
  submitLabel,
  initialName,
  trigger,
  disabled,
  onSave,
}: {
  title: string;
  label: string;
  submitLabel: string;
  initialName: string;
  trigger: string;
  disabled: boolean;
  /** Runs the command; rejects with the refusal. */
  onSave: (name: string) => Promise<void>;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
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
      setOpen(false);
    } catch (failure) {
      form.fail(failure, SAVE_FAILED);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (next) {
          setName(initialName);
          form.reset();
        }
      }}
    >
      <Button
        type="button"
        variant={initialName ? 'outline' : 'default'}
        disabled={disabled}
        onClick={() => {
          setName(initialName);
          form.reset();
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">
              {label}
            </label>
            <input
              id={inputId}
              className={control}
              value={name}
              required
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
              {...form.field('name')}
            />
            <FieldError {...form.errorProps('name')} />
          </div>
          <FieldError>{form.formError}</FieldError>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => setOpen(false)}
            >
              Renunță
            </Button>
            <Button type="submit" disabled={disabled || unchanged}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  return (
    <div className="space-y-2">
      {dated && (
        <p className="text-sm text-muted-foreground">
          Doar punctele acordate în perioada aleasă.
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

function CampaignRow({
  campaign,
  owner,
  range,
  onRun,
  onToggle,
  disabled,
}: {
  campaign: Campaign;
  /** The owning Group's name. */
  owner: string;
  range: CampaignReportRange | null;
  /** Runs a change and rejects with its refusal (the rename pop-up shows it). */
  onRun: (change: CampaignChange) => Promise<void>;
  /** Runs a change and shows a refusal above the list. */
  onToggle: (change: CampaignChange) => Promise<void>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const reportId = useId();
  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="grid min-w-0 gap-0.5">
          <span className="font-medium break-words">{campaign.name}</span>
          <span className="text-sm text-muted-foreground">Grup: {owner}</span>
        </span>
        <span className="flex flex-wrap gap-2">
          <CampaignNameDialog
            title="Redenumește campania"
            label="Numele campaniei"
            submitLabel="Salvează"
            trigger="Redenumește"
            initialName={campaign.name}
            disabled={disabled}
            onSave={(name) => onRun({ kind: 'rename', id: campaign.id, name })}
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              void onToggle({
                kind: 'active',
                id: campaign.id,
                active: !campaign.is_active,
              })
            }
          >
            {campaign.is_active ? 'Dezactivează' : 'Activează'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-expanded={open}
            aria-controls={reportId}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? 'Ascunde raportul' : 'Vezi raportul'}
          </Button>
        </span>
      </div>
      {open && (
        <div id={reportId}>
          <CampaignReportView campaignId={campaign.id} range={range} />
        </div>
      )}
    </li>
  );
}

/**
 * The Campaigns of one Group and every Group below it, each naming its owner:
 * create (in the Group itself), rename, activate, and the report behind each
 * one. Shared by the Campanii screen (which picks the Group through the Work
 * Filter and passes its date range) and the Campanii tab of a Group in
 * Administrare, so there is exactly one of these. The Active / Inactive toggle
 * lives in the URL (`?stare=inactive`); the server decides who may change a
 * row (`campaign_manage_forbidden`), and its refusal is shown.
 */
export function CampaignsPanel({
  group,
  label,
  groups,
  range = {},
}: {
  group: { id: number; name: string };
  label: string;
  /** Groups with their paths: the owners of the listed Campaigns and their names. */
  groups: readonly CampaignOwnerGroup[];
  /** The report's range; `null` while the page's range is inverted. */
  range?: CampaignReportRange | null;
}) {
  const campaigns = useCampaigns();
  const mutation = useCampaignChange();
  const [searchParams, setSearchParams] = useSearchParams();
  const state: CampaignState =
    searchParams.get(CAMPAIGN_STATE_KEY) === 'inactive' ? 'inactive' : 'active';
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const toggleId = useId();

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
  const listed = useMemo(
    () =>
      subtreeCampaigns(campaigns.data ?? [], groups, group.id).filter(
        (campaign) => campaign.is_active === (state === 'active'),
      ),
    [campaigns.data, groups, group.id, state],
  );
  return (
    <>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{label}</h2>
        <CampaignNameDialog
          title="Campanie nouă"
          label="Numele campaniei"
          submitLabel="Creează"
          trigger="Campanie nouă"
          initialName=""
          disabled={mutation.isPending}
          onSave={(name) => run({ kind: 'create', groupId: group.id, name })}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Campaniile grupului și ale subgrupurilor lui. O campanie nouă aparține
        grupului {group.name}.
      </p>
      <div
        role="group"
        aria-labelledby={toggleId}
        className="flex w-fit items-center gap-3"
      >
        <span id={toggleId} className="text-sm font-medium">
          Stare
        </span>
        <span className="flex rounded-lg border border-border p-0.5">
          {(
            [
              ['active', 'Active'],
              ['inactive', 'Inactive'],
            ] as const
          ).map(([value, text]) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={state === value}
              className={cn(
                'min-h-11 sm:min-h-9',
                state === value && 'bg-muted text-foreground',
              )}
              onClick={() => show(value)}
            >
              {text}
            </Button>
          ))}
        </span>
      </div>
      {campaigns.isPending ? (
        <p role="status">Se încarcă campaniile…</p>
      ) : campaigns.isError ? (
        <div role="alert">
          Nu am putut încărca campaniile.{' '}
          <Button variant="outline" onClick={() => void campaigns.refetch()}>
            Reîncearcă
          </Button>
        </div>
      ) : listed.length ? (
        <ul
          className="space-y-3"
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
                (campaign.group_id === group.id ? group.name : 'Grup')
              }
              range={range}
              onRun={run}
              onToggle={toggle}
              disabled={mutation.isPending}
            />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          {state === 'active'
            ? 'Nicio campanie activă în acest grup sau în subgrupurile lui.'
            : 'Nicio campanie inactivă în acest grup sau în subgrupurile lui.'}
        </p>
      )}
    </>
  );
}
