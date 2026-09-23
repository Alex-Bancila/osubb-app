import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import type {
  AdminGroup,
  GroupAuthority,
  GroupCommand,
  RosterEntry,
} from '../../queries/groups-admin';
import {
  GROUP_CATEGORIES,
  membersBelowLevel,
  minLevelChoices,
} from './group-tree';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

function Check({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 size-5 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Who a raised Minimum Level takes out of the Group, named before anything is
 * sent (ruling R23). The confirmation is what sets `p_confirm_removals`, so a
 * form left open while the roster changed cannot remove anyone by surprise —
 * the server answers `group_has_members_below_level` and the list re-renders.
 */
function RemovalPreview({
  leaving,
  minLevel,
}: {
  leaving: RosterEntry[];
  minLevel: number;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm font-medium">
        {leaving.length === 1
          ? 'Un membru iese din grup la nivelul minim '
          : `${leaving.length} membri ies din grup la nivelul minim `}
        {minLevel}:
      </p>
      <ul className="space-y-1 text-sm" aria-label="Membri care ies din grup">
        {leaving.map((entry) => (
          <li key={entry.memberId}>
            {entry.name} — {entry.roleLabel}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Archiving, in its own pop-up: history is kept, the Group stops being used. */
function ArchiveGroupDialog({
  group,
  disabled,
  error,
  onArchive,
}: {
  group: AdminGroup;
  disabled: boolean;
  error: string | null;
  onArchive: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (next) setAttempted(false);
      }}
    >
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setAttempted(false);
          setOpen(true);
        }}
      >
        Arhivează grupul
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Arhivează {group.name}</DialogTitle>
          <DialogDescription>
            Grupul nu mai poate primi taskuri, evenimente sau membri noi.
            Istoricul rămâne.
          </DialogDescription>
        </DialogHeader>
        {attempted && error && (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            <Link
              to="/tracker"
              className="inline-flex min-h-11 items-center underline"
            >
              Vezi taskurile neterminate
            </Link>
          </div>
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
            type="button"
            variant="destructive"
            disabled={disabled}
            onClick={async () => {
              setAttempted(true);
              if (await onArchive()) setOpen(false);
            }}
          >
            Arhivează
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GroupSettingsTab({
  group,
  parent,
  roster,
  authority,
  levels,
  actorLevel,
  busy,
  error,
  lastReason,
  onRun,
}: {
  group: AdminGroup;
  parent: AdminGroup | undefined;
  roster: RosterEntry[];
  authority: GroupAuthority;
  levels: number[];
  actorLevel: number;
  busy: boolean;
  error: string | null;
  /** The server's last refusal reason, so a stale form re-asks (R23). */
  lastReason: string | undefined;
  onRun: (command: GroupCommand) => Promise<boolean>;
}) {
  const [name, setName] = useState(group.name);
  const [managerTitle, setManagerTitle] = useState(group.manager_title ?? '');
  const [accepts, setAccepts] = useState(group.accepts_applications);
  const [applicationLevel, setApplicationLevel] = useState(
    group.application_level === null ? '' : String(group.application_level),
  );
  const [shared, setShared] = useState(group.shared_work_visibility);
  const [minLevel, setMinLevel] = useState(String(group.min_level));
  const [confirmed, setConfirmed] = useState(false);

  const [category, setCategory] = useState(group.category);
  const [competes, setCompetes] = useState(group.competes_in_cup);
  const [countsToward, setCountsToward] = useState(
    group.counts_toward_parent_cup,
  );
  const [automatic, setAutomatic] = useState(group.automatic_membership);
  const [structureMinLevel, setStructureMinLevel] = useState(
    String(group.min_level),
  );
  const [color, setColor] = useState(group.color ?? '');
  const [short, setShort] = useState(group.short ?? '');
  const [isOrganization, setIsOrganization] = useState(group.is_organization);

  // A refused save is the server saying the form was stale: re-ask before the
  // next attempt rather than resending the flag it already rejected. Adjusted
  // during render (the React pattern for state derived from a changed prop),
  // so the list is already back when this render paints.
  const [seenReason, setSeenReason] = useState(lastReason);
  if (seenReason !== lastReason) {
    setSeenReason(lastReason);
    if (lastReason === 'group_has_members_below_level') setConfirmed(false);
  }

  const root = group.parent_id === null;
  const chosenMinLevel = Number(minLevel);
  const choices = minLevelChoices(levels, parent?.min_level ?? 0, actorLevel);
  const leaving = membersBelowLevel(roster, chosenMinLevel);
  const needsConfirmation =
    chosenMinLevel > group.min_level && leaving.length > 0;

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (needsConfirmation && !confirmed) {
      setConfirmed(true);
      return;
    }
    const saved = await onRun({
      kind: 'settings',
      groupId: group.id,
      name,
      managerTitle: managerTitle,
      acceptsApplications: accepts,
      applicationLevel:
        accepts && applicationLevel !== '' ? Number(applicationLevel) : null,
      sharedWorkVisibility: shared,
      minLevel: chosenMinLevel,
      confirmRemovals: needsConfirmation,
    });
    if (saved) setConfirmed(false);
  }

  async function saveStructure(event: FormEvent) {
    event.preventDefault();
    await onRun({
      kind: 'structure',
      groupId: group.id,
      category,
      competesInCup: competes,
      countsTowardParentCup: countsToward,
      automaticMembership: automatic,
      minLevel: root ? Number(structureMinLevel) : group.min_level,
      color: color || null,
      short: short || null,
      isOrganization,
      confirmRemovals: false,
    });
  }

  if (!authority.manageGroup && !authority.editStructure)
    return (
      <p className="text-muted-foreground">
        Poți vedea grupul, dar nu îi poți schimba setările.
      </p>
    );

  return (
    <div className="space-y-8">
      {authority.manageGroup && (
        <form onSubmit={saveSettings} className="max-w-xl space-y-4">
          <h3 className="text-lg font-semibold">Setările grupului</h3>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Numele grupului</span>
            <input
              className={control}
              value={name}
              required
              maxLength={120}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">
              Cum se numește coordonatorul
            </span>
            <input
              className={control}
              value={managerTitle}
              maxLength={80}
              placeholder="BCE, Coordonator Principal…"
              disabled={busy}
              onChange={(event) => setManagerTitle(event.target.value)}
            />
          </label>

          <Check
            label="Primește cereri de înscriere"
            hint="Membrii pot cere să intre în grup."
            checked={accepts}
            disabled={busy}
            onChange={setAccepts}
          />

          {accepts && (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">
                Nivelul de la care se poate cere înscrierea
              </span>
              <select
                className={control}
                value={applicationLevel}
                disabled={busy}
                onChange={(event) => setApplicationLevel(event.target.value)}
              >
                <option value="">Ca nivelul minim al grupului</option>
                {levels
                  .filter((level) => level >= chosenMinLevel)
                  .sort((left, right) => left - right)
                  .map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
              </select>
            </label>
          )}

          <Check
            label="Toți membrii văd taskurile grupului"
            checked={shared}
            disabled={busy}
            onChange={setShared}
          />

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Nivel minim</span>
            <select
              className={control}
              value={minLevel}
              disabled={busy || !authority.editMinLevel}
              onChange={(event) => {
                setMinLevel(event.target.value);
                setConfirmed(false);
              }}
            >
              {[...new Set([group.min_level, ...choices])]
                .sort((left, right) => left - right)
                .map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
            </select>
            {!authority.editMinLevel && (
              <span className="text-sm text-muted-foreground">
                Nivelul minim al unui grup de nivel superior se schimbă de către
                BC.
              </span>
            )}
          </label>

          {needsConfirmation && (
            <RemovalPreview leaving={leaving} minLevel={chosenMinLevel} />
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {needsConfirmation && !confirmed
                ? 'Vezi cine iese din grup'
                : needsConfirmation
                  ? 'Confirmă și salvează'
                  : 'Salvează setările'}
            </Button>
          </div>
        </form>
      )}

      {authority.editStructure && (
        <form onSubmit={saveStructure} className="max-w-xl space-y-4">
          <h3 className="text-lg font-semibold">Structura grupului</h3>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Categorie</span>
            <select
              className={control}
              value={category}
              disabled={busy}
              onChange={(event) => setCategory(event.target.value)}
            >
              {[
                ...GROUP_CATEGORIES,
                ...(group.category === 'organization'
                  ? [{ value: 'organization', label: 'Organizație' }]
                  : []),
              ].map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {root ? (
            <>
              <Check
                label="Concurează în Cupa Departamentelor"
                checked={competes}
                disabled={busy}
                onChange={setCompetes}
              />
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Nivel minim</span>
                <select
                  className={control}
                  value={structureMinLevel}
                  disabled={busy}
                  onChange={(event) => setStructureMinLevel(event.target.value)}
                >
                  {[...new Set([group.min_level, ...choices])]
                    .sort((left, right) => left - right)
                    .map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                </select>
              </label>
              <Check
                label="Grupul organizației"
                hint="Toți membrii activi fac parte din el."
                checked={isOrganization}
                disabled={busy}
                onChange={setIsOrganization}
              />
            </>
          ) : (
            <Check
              label="Punctele merg și la cupa grupului părinte"
              checked={countsToward}
              disabled={busy}
              onChange={setCountsToward}
            />
          )}

          <Check
            label="Membrii se adaugă automat, după nivel"
            hint="Lista de membri nu se mai completează manual."
            checked={automatic}
            disabled={busy}
            onChange={setAutomatic}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Prescurtare</span>
              <input
                className={control}
                value={short}
                maxLength={16}
                disabled={busy}
                onChange={(event) => setShort(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Culoare</span>
              <input
                className={control}
                value={color}
                placeholder="#C8102E"
                disabled={busy}
                onChange={(event) => setColor(event.target.value)}
              />
            </label>
          </div>

          <Button type="submit" variant="outline" disabled={busy}>
            Salvează structura
          </Button>
        </form>
      )}

      {authority.archive && group.status === 'active' && (
        <section className="max-w-xl space-y-2 border-t pt-6">
          <h3 className="text-lg font-semibold">Arhivare</h3>
          <ArchiveGroupDialog
            group={group}
            disabled={busy}
            error={error}
            onArchive={() => onRun({ kind: 'archive', groupId: group.id })}
          />
        </section>
      )}
    </div>
  );
}
