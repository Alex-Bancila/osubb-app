import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Panel } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { ColorPicker } from '../../components/ui/color-picker';
import { FieldError } from '../../components/ui/field';
import { InfoHint } from '../../components/ui/info-hint';
import { Input } from '../../components/ui/input';
import { ChoiceRow } from '../../components/ui/radio-group';
import { SegmentedRadio } from '../../components/ui/segmented-radio';
import { Select, type SelectOption } from '../../components/ui/select';
import { SwitchRow } from '../../components/ui/switch';
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
import { CommandError, reasonCopy } from '../../lib/command-reasons';
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
import { GroupDeleteDialog } from './GroupDeleteDialog';

const SAVE_FAILED = 'Nu am putut salva schimbarea. Reîncearcă.';
/* Yes/no rows sit together, 4 px apart: each is already a 44 px row, so the
   form's 16 px field gap would leave them floating apart. */
const choicesClass = 'flex flex-col gap-1';

/**
 * A yes/no setting saved with its form (#842): the kit's checkbox in a 44 px
 * row whose words are its name. What the setting means, said once, waits
 * behind the "i" at the row's end (`info`); why it cannot change now stays
 * in view under the label (`hint`).
 */
function Check({
  label,
  hint,
  info,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  /** In view: the reason the box is locked. */
  hint?: ReactNode;
  /** Behind the "i": what the setting does. */
  info?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const id = useId();
  const described =
    [hint ? `${id}-hint` : null, info ? `${id}-info` : null]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className="flex items-start justify-between gap-2">
      <ChoiceRow className="min-w-0 flex-1 items-start">
        <Checkbox
          className="mt-0.5"
          checked={checked}
          disabled={disabled}
          aria-describedby={described}
          onCheckedChange={(next) => onChange?.(next)}
        />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {hint && (
            <span id={`${id}-hint`} className="text-sm text-muted-foreground">
              {hint}
            </span>
          )}
        </span>
      </ChoiceRow>
      {info && (
        // -my-3 is for a label's row; here the "i" is a row of its own height.
        <InfoHint label={`Despre: ${label}`} id={`${id}-info`} className="my-0">
          {info}
        </InfoHint>
      )}
    </div>
  );
}

/**
 * A labelled field: the words above the control, 6 px apart. An input sits
 * inside the label; a drop-down is named through `htmlFor`, its own `id`.
 */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  if (htmlFor)
    return (
      <div className="grid gap-1.5">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {children}
      </div>
    );
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

/** The Minimum Level options: the ladder the caller may choose, plus the
 *  stored value, which stays readable even off the ladder (R29b). */
function minLevelOptions(
  current: number,
  choices: readonly number[],
): SelectOption[] {
  return [...new Set([current, ...choices])]
    .sort((left, right) => left - right)
    .map((level) => ({
      value: String(level),
      label: minimumLevelText(level),
      // A stored off-ladder level (the Moderator's 9) stays readable as the
      // current value, never a choice (R29b).
      disabled: !isMinimumLevel(level),
    }));
}

/** "Ca nivelul minim al grupului": no Application Level of its own. */
const SAME_AS_MIN_LEVEL = 'same';

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
 * A Group's settings, structure, archiving and deletion (layout AD3): three panels in
 * a reading-width column, each as tall as its content. Each form saves on its own, and
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
  canDelete = false,
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
  /**
   * Offer **Șterge definitiv** (#1017): whoever may archive the Group, and
   * BC and the Moderator on an archived one.
   */
  canDelete?: boolean;
}) {
  const root = group.parent_id === null;
  const categoryId = useId();
  const fieldId = useId();
  const [name, setName] = useState(group.name);
  const [managerTitle, setManagerTitle] = useState(group.manager_title ?? '');
  const [responsibleTitle, setResponsibleTitle] = useState(
    group.responsible_title ?? '',
  );
  const [accepts, setAccepts] = useState(group.accepts_applications);
  const [applicationLevel, setApplicationLevel] = useState(
    group.application_level === null ? '' : String(group.application_level),
  );
  // The application form link (#698): one pair, saved and cleared together.
  const [applicationForm, setApplicationForm] = useState({
    label: group.application_form_label ?? '',
    url: group.application_form_url ?? '',
  });
  // Optional as a whole: off is "no form" (the pair stored null), on asks for
  // both halves.
  const [hasForm, setHasForm] = useState(
    Boolean(group.application_form_label || group.application_form_url),
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
      responsibleTitle,
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
    // The switch is on with nothing written: update_group would store that
    // as "no form", so ask for the pair instead of saving the opposite of
    // what the switch says.
    if (accepts && hasForm && form.label === null && form.url === null) {
      settingsForm.fail(
        new CommandError({ message: 'application_form_incomplete' }, ''),
        SAVE_FAILED,
      );
      return;
    }
    const saved = await onRun(
      {
        kind: 'settings',
        groupId: group.id,
        ...settings,
        // Both or neither (the schema's pair rule): the switch turned off
        // empties the pair, which clears it. While Applications are off the
        // pair is hidden, and the stored one is still sent, so turning them
        // off never loses the link.
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
  if (!showSettings && !showStructure && !showArchive && !canDelete)
    return null;

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
            <Input
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
          <Field label="Cum se numește coordonatorul (opțional)">
            <Input
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

        {/* #962: what this Group calls its Responsibles -- "Coordonator"
            for a Department's BCE members. It names the Roluri panel and
            pre-fills each appointment's own title. */}
        <div className="grid gap-1.5">
          <Field label="Cum se numesc responsabilii (opțional)">
            <Input
              value={responsibleTitle}
              maxLength={80}
              placeholder="Coordonator, Responsabil de Proiect…"
              disabled={busy}
              onChange={(event) => setResponsibleTitle(event.target.value)}
              {...settingsForm.field('responsibleTitle')}
            />
          </Field>
          <FieldError {...settingsForm.errorProps('responsibleTitle')} />
        </div>

        {!root && (
          <div className="grid gap-1.5">
            <Field label="Nivel minim" htmlFor={`${fieldId}-min-level`}>
              <Select
                id={`${fieldId}-min-level`}
                value={minLevel}
                options={minLevelOptions(group.min_level, choices)}
                disabled={busy || !authority.editMinLevel}
                onValueChange={(next) => {
                  setMinLevel(next);
                  setConfirmed(false);
                }}
                {...settingsForm.field('minLevel')}
              />
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
            hint={group.is_private ? reasonCopy('group_private') : undefined}
            info={
              group.is_private
                ? undefined
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
              <Field
                label="Nivelul de la care se poate cere înscrierea"
                htmlFor={`${fieldId}-application-level`}
              >
                <Select
                  id={`${fieldId}-application-level`}
                  value={applicationLevel || SAME_AS_MIN_LEVEL}
                  options={[
                    {
                      value: SAME_AS_MIN_LEVEL,
                      label: 'Ca nivelul minim al grupului',
                    },
                    ...[...new Set(levels)]
                      .filter(
                        (level) =>
                          isMinimumLevel(level) && level >= chosenMinLevel,
                      )
                      .sort((left, right) => left - right)
                      .map((level) => ({
                        value: String(level),
                        label: minimumLevelText(level),
                      })),
                    // The stored off-ladder level (the Moderator's 9) stays
                    // readable as the current value, never a choice (R29b).
                    ...(group.application_level !== null &&
                    !isMinimumLevel(group.application_level)
                      ? [
                          {
                            value: String(group.application_level),
                            label: minimumLevelText(group.application_level),
                            disabled: true,
                          },
                        ]
                      : []),
                  ]}
                  disabled={busy}
                  onValueChange={(next) =>
                    setApplicationLevel(next === SAME_AS_MIN_LEVEL ? '' : next)
                  }
                  {...settingsForm.field('applicationLevel')}
                />
              </Field>
              <FieldError {...settingsForm.errorProps('applicationLevel')} />
            </div>

            {/* Optional as a whole (the switch), never half: a form has both
                a label and an address, so neither field says "(opțional)". */}
            <div className="flex flex-col gap-3">
              <SwitchRow
                label="Formular de înscriere"
                checked={hasForm}
                disabled={busy}
                onCheckedChange={(next) => {
                  setHasForm(next);
                  if (!next) setApplicationForm({ label: '', url: '' });
                }}
              />
              {hasForm && (
                <div
                  role="group"
                  aria-label="Formular de înscriere"
                  className="flex flex-col gap-3"
                >
                  <div className="grid gap-1.5">
                    <Field label="Eticheta butonului">
                      <Input
                        value={applicationForm.label}
                        required
                        disabled={busy}
                        onChange={(event) =>
                          setApplicationForm({
                            ...applicationForm,
                            label: event.target.value,
                          })
                        }
                        {...settingsForm.field('applicationForm.label')}
                      />
                    </Field>
                    <FieldError
                      {...settingsForm.errorProps('applicationForm.label')}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={`${fieldId}-form-url`}
                        className="text-sm font-medium"
                      >
                        Adresa formularului
                      </label>
                      <InfoHint
                        label="Despre adresa formularului"
                        id={`${fieldId}-form-url-hint`}
                      >
                        Adresa începe cu http:// sau https://
                      </InfoHint>
                    </div>
                    <Input
                      id={`${fieldId}-form-url`}
                      type="url"
                      placeholder="https://"
                      value={applicationForm.url}
                      required
                      disabled={busy}
                      onChange={(event) =>
                        setApplicationForm({
                          ...applicationForm,
                          url: event.target.value,
                        })
                      }
                      {...settingsForm.field(
                        'applicationForm.url',
                        `${fieldId}-form-url-hint`,
                      )}
                    />
                    <FieldError
                      {...settingsForm.errorProps('applicationForm.url')}
                    />
                  </div>
                </div>
              )}
            </div>
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
        {group.category === 'organization' ? (
          // Four options with the Organization's own: a select.
          <Field label="Categorie" htmlFor={`${fieldId}-category`}>
            <Select
              id={`${fieldId}-category`}
              value={category}
              options={[
                ...GROUP_CATEGORIES,
                { value: 'organization', label: 'Organizație' },
              ]}
              disabled={busy}
              onValueChange={setCategory}
            />
          </Field>
        ) : (
          // Three: one segmented choice, as when the Group was created.
          <div className="grid gap-1.5">
            <span id={categoryId} className="text-sm font-medium">
              Categorie
            </span>
            <SegmentedRadio<string>
              aria-labelledby={categoryId}
              options={GROUP_CATEGORIES}
              value={category}
              onValueChange={setCategory}
              disabled={busy}
            />
          </div>
        )}

        {root && (
          <Field label="Nivel minim" htmlFor={`${fieldId}-structure-min-level`}>
            <Select
              id={`${fieldId}-structure-min-level`}
              value={structureMinLevel}
              options={minLevelOptions(group.min_level, choices)}
              disabled={busy}
              onValueChange={(next) => {
                setStructureMinLevel(next);
                setStructureConfirmed(false);
              }}
            />
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
              info="Toți membrii activi fac parte din el."
              checked
              disabled
            />
          )}
          <Check
            label="Membrii se adaugă automat, după nivel"
            info="Lista de membri nu se mai completează manual."
            checked={automatic}
            disabled={busy}
            onChange={setAutomatic}
          />
          <Check
            label="Grup privat"
            // Why it is locked, or what unticking it leaves behind, is read
            // before saving; what a Private Group is waits behind the "i".
            hint={
              isOrganization
                ? reasonCopy('private_not_allowed_for_organization')
                : inheritsPrivate
                  ? reasonCopy('private_parent')
                  : group.is_private && !isPrivate && subtree.length > 0
                    ? 'Subgrupurile rămân private. Fiecare se face public din setările lui.'
                    : undefined
            }
            info={
              isOrganization || inheritsPrivate ? undefined : PRIVATE_GROUP_HINT
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
            <Field label="Prescurtare (opțional)">
              <Input
                value={short}
                maxLength={16}
                disabled={busy}
                onChange={(event) => setShort(event.target.value)}
                {...structureForm.field('short')}
              />
            </Field>
            <FieldError {...structureForm.errorProps('short')} />
          </div>
          <div
            className="grid gap-1.5 sm:col-span-2"
            {...structureForm.slot('color')}
          >
            <span className="text-sm font-medium">Culoare (opțional)</span>
            <ColorPicker
              label="Alege culoarea grupului"
              noneLabel="Fără culoare"
              value={color}
              disabled={busy}
              onChange={setColor}
            />
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

  // One reading-width column: the forms are unrelated and of different
  // lengths, so each panel is as tall as its content rather than stretched
  // to its neighbour (Alex, 2026-09-28: no half-empty boxes).
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {settingsPanel}
      {structurePanel}

      {(showArchive || canDelete) && (
        <Panel
          title={
            !canDelete
              ? 'Arhivare'
              : showArchive
                ? 'Arhivare și ștergere'
                : 'Ștergere'
          }
        >
          <div className="flex flex-col divide-y divide-border">
            {showArchive && (
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 last:pb-0">
                <p className="m-0 min-w-0 flex-1 basis-60 text-sm text-muted-foreground">
                  Grupul nu mai primește taskuri, evenimente sau membri noi.
                  Istoricul rămâne.
                </p>
                <ArchiveGroupDialog
                  group={group}
                  disabled={busy}
                  error={error}
                  onArchive={() =>
                    onRun({ kind: 'archive', groupId: group.id })
                  }
                />
              </div>
            )}
            {canDelete && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 first:pt-0">
                <p className="m-0 min-w-0 flex-1 basis-60 text-sm text-muted-foreground">
                  Grupul dispare cu tot ce conține: subgrupuri, taskuri și
                  punctele lor, evenimente, anunțuri, campanii. Nu poate fi
                  recuperat.
                </p>
                <GroupDeleteDialog
                  group={group}
                  disabled={busy}
                  onArchive={
                    showArchive
                      ? (onFailure) =>
                          onRun(
                            { kind: 'archive', groupId: group.id },
                            onFailure,
                          )
                      : undefined
                  }
                />
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
