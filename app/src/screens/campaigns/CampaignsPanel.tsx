import { useId, useRef, useState, type FormEvent } from 'react';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { formatPoints } from '../../lib/format';
import {
  CampaignError,
  useCampaignChange,
  useCampaignReport,
  useCampaigns,
  type Campaign,
  type CampaignChange,
} from '../../queries/campaigns';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/** A small pop-up that asks for one Campaign name: used to create and to rename. */
function CampaignNameDialog({
  title,
  label,
  submitLabel,
  initialName,
  trigger,
  disabled,
  error,
  onSave,
}: {
  title: string;
  label: string;
  submitLabel: string;
  initialName: string;
  trigger: string;
  disabled: boolean;
  /** The last save's refusal, shown inside the pop-up while it is open. */
  error: string | null;
  onSave: (name: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  // Show only a refusal of a save made from this pop-up since it opened.
  const [attempted, setAttempted] = useState(false);
  const unchanged = name.trim() === initialName.trim();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || unchanged) return;
    setAttempted(true);
    // A rejected save keeps the pop-up and the typed name for a retry.
    if (await onSave(name)) setOpen(false);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (next) {
          setName(initialName);
          setAttempted(false);
        }
      }}
    >
      <Button
        type="button"
        variant={initialName ? 'outline' : 'default'}
        disabled={disabled}
        onClick={() => {
          setName(initialName);
          setAttempted(false);
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">{label}</span>
            <input
              className={control}
              value={name}
              required
              maxLength={200}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {attempted && error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => setOpen(false)}
            >
              Renunță
            </Button>
            <Button
              type="submit"
              disabled={disabled || !name.trim() || unchanged}
            >
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
function CampaignReportView({ campaignId }: { campaignId: number }) {
  const report = useCampaignReport(campaignId);
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
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="font-semibold">{formatPoints(totals.points)}</span>{' '}
        puncte · {totals.tasksCompleted} din {totals.tasksTotal} taskuri
        finalizate
      </p>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nimeni nu a primit încă puncte în această campanie.
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
  onChange,
  disabled,
  error,
}: {
  campaign: Campaign;
  onChange: (change: CampaignChange) => Promise<boolean>;
  disabled: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const reportId = useId();
  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="grid min-w-0 gap-0.5">
          <span className="font-medium break-words">{campaign.name}</span>
          <span className="text-sm text-muted-foreground">
            {campaign.is_active ? 'Activă' : 'Inactivă'}
          </span>
        </span>
        <span className="flex flex-wrap gap-2">
          <CampaignNameDialog
            title="Redenumește campania"
            label="Numele campaniei"
            submitLabel="Salvează"
            trigger="Redenumește"
            initialName={campaign.name}
            disabled={disabled}
            error={error}
            onSave={(name) =>
              onChange({ kind: 'rename', id: campaign.id, name })
            }
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              void onChange({
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
          <CampaignReportView campaignId={campaign.id} />
        </div>
      )}
    </li>
  );
}

/**
 * One Group's Campaigns: create, rename, activate, and the report behind each
 * one. Shared by the Campanii screen (which picks the Group first) and the
 * Campanii tab of a Group in Administrare, so there is exactly one of these.
 */
export function CampaignsPanel({
  group,
  label,
}: {
  group: { id: number; name: string };
  label: string;
}) {
  const campaigns = useCampaigns(group.id);
  const mutation = useCampaignChange();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function save(change: CampaignChange) {
    if (submitting.current) return false;
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
      return true;
    } catch (failure) {
      setError(
        failure instanceof CampaignError
          ? failure.message
          : 'Nu am putut salva campania. Reîncearcă.',
      );
      return false;
    } finally {
      submitting.current = false;
    }
  }

  const own = campaigns.data?.filter((row) => row.group_id === group.id);
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
          error={error}
          onSave={(name) => save({ kind: 'create', groupId: group.id, name })}
        />
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
      ) : (
        <ul className="space-y-3" aria-label="Campaniile grupului">
          {own?.map((campaign) => (
            <CampaignRow
              key={`${campaign.id}:${campaign.name}`}
              campaign={campaign}
              onChange={save}
              disabled={mutation.isPending}
              error={error}
            />
          ))}
          {!own?.length && <li>Grupul nu are încă nicio campanie.</li>}
        </ul>
      )}
    </>
  );
}
