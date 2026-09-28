import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from 'cn';
import { AttachedLinkFields } from '../../components/attached-link/AttachedLinkFields';
import { PageGrid, Panel, SubHeading } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { FieldError } from '../../components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '../../components/ui/native-select';
import { ChoiceRow } from '../../components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  applicationFormFailure,
  fieldForReason,
  groupSettingsSchema,
  groupStructureSchema,
} from '../../lib/schemas/group';
import { reasonCopy } from '../../lib/command-reasons';
import { isMinimumLevel, minimumLevelText } from '../../lib/minimum-level';
import { useFormValidation } from '../../lib/use-form-validation';
import type {
  AdminGroup,
  GroupAuthority,
  RosterEntry,
  RunGroupCommand,
} from '../../queries/groups-admin';
import {
  GROUP_CATEGORIES,
  membersBelowLevel,
  minLevelChoices,
  PRIVATE_GROUP_HINT,
  unfinishedTasksPath,
} from './group-tree';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
const SAVE_FAILED = 'Nu am putut salva schimbarea. Reîncearcă.';
/* Yes/no rows sit together, 4 px apart: each is already a 44 px row, so the
   form's 16 px field gap would leave them floating apart. */
const choicesClass = 'flex flex-col gap-1';

/**
 * A yes/no setting saved with its form (#842): the kit's checkbox in a 44 px
 * row whose words are its name, the hint under the label.
 */
function Check({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <ChoiceRow className="items-start">
      <Checkbox
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange?.(next)}
      />
      <span className="grid gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      </span>
    </ChoiceRow>
  );
}

/** A labelled field: the words above the control, 6 px apart. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

/** The Minimum Level options: the ladder the caller may choose, plus the
 *  stored value, which stays readable even off the ladder (R29b). */
function MinLevelOptions({
  current,
  choices,
}: {
  current: number;
  choices: readonly number[];
}) {
  return (
    <>
      {[...new Set([current, ...choices])]
        .sort((left, right) => left - right)
        .map((level) => (
          <NativeSelectOption
            key={level}
            value={level}
            // A stored off-ladder level (the Moderator's 9) stays readable as
            // the current value, never a choice (R29b).
            disabled={!isMinimumLevel(level)}
          >
            {minimumLevelText(level)}
          </NativeSelectOption>
        ))}
    </>
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
    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm font-medium">
        {leaving.length === 1
          ? 'Un membru iese din grup la nivelul minim '
          : `${leaving.length} membri ies din grup la nivelul minim `}
        {minimumLevelText(minLevel)}:
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

/**
 * What turning a Group private does, named before anything is sent (ruling
 * R25): the Group and every Group below it disappear for everyone outside
 * them, and their Applications stop. The confirmation is the second press of
 * the save button, like the Minimum-Level removals above.
 */
function PrivatePreview({
  group,
  subtree,
}: {
  group: AdminGroup;
  subtree: AdminGroup[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <p className="text-sm font-medium">
        {subtree.length === 0
          ? `${group.name} va fi vizibil doar membrilor lui, coordonatorilor de pe traseu și BC.`
          : subtree.length === 1
            ? `${group.name} și subgrupul lui vor fi vizibile doar membrilor lor, coordonatorilor de pe traseu și BC:`
            : `${group.name} și toate cele ${subtree.length} subgrupuri ale lui vor fi vizibile doar membrilor lor, coordonatorilor de pe traseu și BC:`}
      </p>
      {subtree.length > 0 && (
        <ul
          className="space-y-1 text-sm"
          aria-label="Subgrupuri care devin private"
        >
          {subtree.map((below) => (
            <li key={below.id}>{below.name}</li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        Cererile de înscriere se opresc, iar cele în așteptare se retrag.
      </p>
    </div>
  );
}

/**
 * Archiving, in its own pop-up: history is kept, the Group stops being used.
 * A refusal for unfinished work links to exactly that work (navigation D9).
 */
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
              to={unfinishedTasksPath(group)}
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

/**
 * A Group's settings, structure and archiving (layout AD3): three panels in
 * a reading-width column, or Setări beside Structura from 768 px when the
 * viewer edits both, with Arhivare below. Each form saves on its own, and
 * each field shows once — a top-level Group's Minimum Level is structure
 * (BC's), a Child Group's is its Managers' setting (relevance B52).
 */
export function GroupSettingsTab({
  group,
  parent,
  subtree = [],
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
  /** Every Group below this one: what turning it private also hides. */
  subtree?: AdminGroup[];
  roster: RosterEntry[];
  authority: GroupAuthority;
  levels: number[];
  actorLevel: number;
  busy: boolean;
  error: string | null;
  /** The server's last refusal reason, so a stale form re-asks (R23). */
  lastReason: string | undefined;
  onRun: RunGroupCommand;
}) {
  const root = group.parent_id === null;
  const [name, setName] = useState(group.name);
  const [managerTitle, setManagerTitle] = useState(group.manager_title ?? '');
  const [accepts, setAccepts] = useState(group.accepts_applications);
  const [applicationLevel, setApplicationLevel] = useState(
    group.application_level === null ? '' : String(group.application_level),
  );
  // The application form link (#698): one pair, saved and cleared together.
  const [applicationForm, setApplicationForm] = useState({
    label: group.application_form_label ?? '',
    url: group.application_form_url ?? '',
  });
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
  const [isPrivate, setIsPrivate] = useState(group.is_private);
  const [structureConfirmed, setStructureConfirmed] = useState(false);

  // A refused save is the server saying the form was stale: re-ask before the
  // next attempt rather than resending the flag it already rejected. Adjusted
  // during render (the React pattern for state derived from a changed prop),
  // so the list is already back when this render paints.
  const [seenReason, setSeenReason] = useState(lastReason);
  if (seenReason !== lastReason) {
    setSeenReason(lastReason);
    if (lastReason === 'group_has_members_below_level') {
      setConfirmed(false);
      setStructureConfirmed(false);
    }
  }

  // The Organization Group is fixed (relevance B53): there is exactly one,
  // it is never private, and no form here turns another Group into it.
  const isOrganization = group.is_organization;
  // Mirrors update_group_structure (#756): a Child Group of a Private Group
  // stays private (private_parent), and the Organization Group is never
  // private (private_not_allowed_for_organization).
  const inheritsPrivate = parent?.is_private === true;
  const privateValue = inheritsPrivate || (!isOrganization && isPrivate);
  const turningPrivate = privateValue && !group.is_private;
  // A root's Minimum Level is structure, not a setting (Structura holds it),
  // so the settings form sends the stored one back.
  const chosenMinLevel = root ? group.min_level : Number(minLevel);
  const choices = minLevelChoices(levels, parent?.min_level ?? 0, actorLevel);
  const leaving = membersBelowLevel(roster, chosenMinLevel);
  const needsConfirmation =
    chosenMinLevel > group.min_level && leaving.length > 0;
  const chosenStructureMinLevel = root
    ? Number(structureMinLevel)
    : group.min_level;
  const leavingStructure = membersBelowLevel(roster, chosenStructureMinLevel);
  const structureRemovals =
    chosenStructureMinLevel > group.min_level && leavingStructure.length > 0;
  const structureNeedsPreview = turningPrivate || structureRemovals;

  // Ruling R8: each form checks its fields on blur and on save, and a refusal
  // lands under the field it names.
  const settingsForm = useFormValidation(
    groupSettingsSchema,
    {
      name,
      managerTitle,
      acceptsApplications: accepts,
      // '' is "Ca nivelul minim al grupului": send the Minimum Level chosen
      // in this same save (#731), not null -- update_group refuses a null
      // level while Applications are on.
      applicationLevel: accepts
        ? applicationLevel === ''
          ? chosenMinLevel
          : Number(applicationLevel)
        : null,
      sharedWorkVisibility: shared,
      minLevel: chosenMinLevel,
      applicationForm,
    },
    fieldForReason,
  );
  const structureForm = useFormValidation(
    groupStructureSchema,
    { color, short },
    fieldForReason,
  );

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const values = settingsForm.validate();
    if (!values) return;
    if (needsConfirmation && !confirmed) {
      setConfirmed(true);
      return;
    }
    const { applicationForm: form, ...settings } = values;
    const saved = await onRun(
      {
        kind: 'settings',
        groupId: group.id,
        ...settings,
        // Both or neither (the schema's pair rule): an emptied pair clears it.
        // While Applications are off the pair is hidden, and the stored one
        // is still sent, so turning them off never loses the link.
        applicationFormLabel: form.label,
        applicationFormUrl: form.url,
        confirmRemovals: needsConfirmation,
      },
      (failure) =>
        settingsForm.fail(applicationFormFailure(failure), SAVE_FAILED),
    );
    if (saved) setConfirmed(false);
  }

  async function saveStructure(event: FormEvent) {
    event.preventDefault();
    const values = structureForm.validate();
    if (!values) return;
    if (structureNeedsPreview && !structureConfirmed) {
      setStructureConfirmed(true);
      return;
    }
    const saved = await onRun(
      {
        kind: 'structure',
        groupId: group.id,
        category,
        competesInCup: competes,
        countsTowardParentCup: countsToward,
        automaticMembership: automatic,
        minLevel: chosenStructureMinLevel,
        color: values.color,
        short: values.short,
        isOrganization,
        isPrivate: privateValue,
        confirmRemovals: structureRemovals,
      },
      (failure) => structureForm.fail(failure, SAVE_FAILED),
    );
    if (saved) setStructureConfirmed(false);
  }

  const showSettings = authority.manageGroup;
  const showStructure = authority.editStructure;
  const showArchive = authority.archive && group.status === 'active';
  // The page shows this tab only to someone with one of the three; the one
  // refusal line lives on the page, not here (relevance B49).
  if (!showSettings && !showStructure && !showArchive) return null;

  const settingsPanel = showSettings && (
    <Panel title="Setările grupului">
      <form
        onSubmit={saveSettings}
        noValidate
        aria-label="Setările grupului"
        className="flex flex-col gap-4"
      >
        <div className="grid gap-1.5">
          <Field label="Numele grupului">
            <input
              className={control}
              value={name}
              required
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              {...settingsForm.field('name')}
            />
          </Field>
          <FieldError {...settingsForm.errorProps('name')} />
        </div>

        <div className="grid gap-1.5">
          <Field label="Cum se numește coordonatorul">
            <input
              className={control}
              value={managerTitle}
              maxLength={80}
              placeholder="BCE, Coordonator Principal…"
              disabled={busy}
              onChange={(event) => setManagerTitle(event.target.value)}
              {...settingsForm.field('managerTitle')}
            />
          </Field>
          <FieldError {...settingsForm.errorProps('managerTitle')} />
        </div>

        {!root && (
          <div className="grid gap-1.5">
            <Field label="Nivel minim">
              <NativeSelect
                value={minLevel}
                disabled={busy || !authority.editMinLevel}
                onChange={(event) => {
                  setMinLevel(event.target.value);
                  setConfirmed(false);
                }}
                {...settingsForm.field('minLevel')}
              >
                <MinLevelOptions current={group.min_level} choices={choices} />
              </NativeSelect>
            </Field>
            <FieldError {...settingsForm.errorProps('minLevel')} />
          </div>
        )}
        {needsConfirmation && (
          <RemovalPreview leaving={leaving} minLevel={chosenMinLevel} />
        )}

        <div className={choicesClass}>
          <Check
            label="Toți membrii văd taskurile grupului"
            checked={shared}
            disabled={busy}
            onChange={setShared}
          />
          <Check
            label="Primește cereri de înscriere"
            hint={
              group.is_private
                ? reasonCopy('group_private')
                : 'Membrii pot cere să intre în grup.'
            }
            checked={accepts}
            disabled={busy || group.is_private}
            onChange={setAccepts}
          />
        </div>

        {/* The level and the form link only matter while Applications are
            on (relevance B54). */}
        {accepts && (
          <div className="flex flex-col gap-4 border-l-2 border-border pl-4">
            <div className="grid gap-1.5">
              <Field label="Nivelul de la care se poate cere înscrierea">
                <NativeSelect
                  value={applicationLevel}
                  disabled={busy}
                  onChange={(event) => setApplicationLevel(event.target.value)}
                  {...settingsForm.field('applicationLevel')}
                >
                  <NativeSelectOption value="">
                    Ca nivelul minim al grupului
                  </NativeSelectOption>
                  {[...new Set(levels)]
                    .filter(
                      (level) =>
                        isMinimumLevel(level) && level >= chosenMinLevel,
                    )
                    .sort((left, right) => left - right)
                    .map((level) => (
                      <NativeSelectOption key={level} value={level}>
                        {minimumLevelText(level)}
                      </NativeSelectOption>
                    ))}
                  {group.application_level !== null &&
                    !isMinimumLevel(group.application_level) && (
                      // The stored off-ladder level (the Moderator's 9) stays
                      // readable as the current value, never a choice (R29b).
                      <NativeSelectOption
                        value={group.application_level}
                        disabled
                      >
                        {minimumLevelText(group.application_level)}
                      </NativeSelectOption>
                    )}
                </NativeSelect>
              </Field>
              <FieldError {...settingsForm.errorProps('applicationLevel')} />
            </div>

            <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
              <legend className="mb-3 p-0">
                <SubHeading as="p" variant="label">
                  Formular de înscriere
                </SubHeading>
              </legend>
              <AttachedLinkFields
                value={applicationForm}
                onChange={setApplicationForm}
                form={settingsForm}
                name="applicationForm"
                labelText="Eticheta butonului"
                urlText="Adresa formularului"
                disabled={busy}
              />
            </fieldset>
          </div>
        )}

        <FieldError>{settingsForm.formError}</FieldError>

        <div>
          <Button type="submit" disabled={busy}>
            {needsConfirmation && !confirmed
              ? 'Vezi cine iese din grup'
              : needsConfirmation
                ? 'Confirmă și salvează'
                : 'Salvează setările'}
          </Button>
        </div>
      </form>
    </Panel>
  );

  const structurePanel = showStructure && (
    <Panel title="Structura grupului">
      <form
        onSubmit={saveStructure}
        noValidate
        aria-label="Structura grupului"
        className="flex flex-col gap-4"
      >
        <Field label="Categorie">
          <NativeSelect
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
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        {root && (
          <Field label="Nivel minim">
            <NativeSelect
              value={structureMinLevel}
              disabled={busy}
              onChange={(event) => {
                setStructureMinLevel(event.target.value);
                setStructureConfirmed(false);
              }}
            >
              <MinLevelOptions current={group.min_level} choices={choices} />
            </NativeSelect>
          </Field>
        )}
        {structureRemovals && (
          <RemovalPreview
            leaving={leavingStructure}
            minLevel={chosenStructureMinLevel}
          />
        )}

        <div className={choicesClass}>
          {root ? (
            <Check
              label="Concurează în Cupa Departamentelor"
              checked={competes}
              disabled={busy}
              onChange={setCompetes}
            />
          ) : (
            <Check
              label="Punctele merg și la cupa grupului părinte"
              checked={countsToward}
              disabled={busy}
              onChange={setCountsToward}
            />
          )}
          {isOrganization && (
            <Check
              label="Grupul organizației"
              hint="Toți membrii activi fac parte din el."
              checked
              disabled
            />
          )}
          <Check
            label="Membrii se adaugă automat, după nivel"
            hint="Lista de membri nu se mai completează manual."
            checked={automatic}
            disabled={busy}
            onChange={setAutomatic}
          />
          <Check
            label="Grup privat"
            hint={
              isOrganization
                ? reasonCopy('private_not_allowed_for_organization')
                : inheritsPrivate
                  ? reasonCopy('private_parent')
                  : group.is_private && !isPrivate && subtree.length > 0
                    ? 'Subgrupurile rămân private. Fiecare se face public din setările lui.'
                    : PRIVATE_GROUP_HINT
            }
            checked={privateValue}
            disabled={busy || inheritsPrivate || isOrganization}
            onChange={(checked) => {
              setIsPrivate(checked);
              setStructureConfirmed(false);
            }}
          />
        </div>
        {turningPrivate && structureConfirmed && (
          <PrivatePreview group={group} subtree={subtree} />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Field label="Prescurtare">
              <input
                className={control}
                value={short}
                maxLength={16}
                disabled={busy}
                onChange={(event) => setShort(event.target.value)}
                {...structureForm.field('short')}
              />
            </Field>
            <FieldError {...structureForm.errorProps('short')} />
          </div>
          <div className="grid gap-1.5">
            <Field label="Culoare">
              <input
                className={control}
                value={color}
                placeholder="#C8102E"
                disabled={busy}
                onChange={(event) => setColor(event.target.value)}
                {...structureForm.field('color')}
              />
            </Field>
            <FieldError {...structureForm.errorProps('color')} />
          </div>
        </div>
        <FieldError>{structureForm.formError}</FieldError>

        <div>
          <Button type="submit" disabled={busy}>
            {structureNeedsPreview && !structureConfirmed
              ? turningPrivate
                ? 'Vezi ce devine privat'
                : 'Vezi cine iese din grup'
              : structureNeedsPreview
                ? 'Confirmă și salvează'
                : 'Salvează structura'}
          </Button>
        </div>
      </form>
    </Panel>
  );

  const both = showSettings && showStructure;
  return (
    <div className={cn('flex flex-col gap-6', !both && 'max-w-2xl')}>
      {both ? (
        <PageGrid columns={2} alignHeaders>
          {settingsPanel}
          {structurePanel}
        </PageGrid>
      ) : (
        settingsPanel || structurePanel
      )}

      {showArchive && (
        <Panel title="Arhivare">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 min-w-0 flex-1 basis-60 text-sm text-muted-foreground">
              Grupul nu mai primește taskuri, evenimente sau membri noi.
              Istoricul rămâne.
            </p>
            <ArchiveGroupDialog
              group={group}
              disabled={busy}
              error={error}
              onArchive={() => onRun({ kind: 'archive', groupId: group.id })}
            />
          </div>
        </Panel>
      )}
    </div>
  );
}
