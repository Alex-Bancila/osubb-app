import { useId, useState, type FormEvent } from 'react';
import { PlusIcon } from 'lucide-react';
import { FabAction } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { ColorPicker } from '../../components/ui/color-picker';
import { FieldError } from '../../components/ui/field';
import { Select } from '../../components/ui/select';
import { FormSheet, FormSheetFooter } from '../../components/ui/form-sheet';
import { InfoHint } from '../../components/ui/info-hint';
import { Input } from '../../components/ui/input';
import { ChoiceRow } from '../../components/ui/radio-group';
import { SegmentedRadio } from '../../components/ui/segmented-radio';
import { GroupFilterCombobox } from '../../components/group/GroupFilterCombobox';
import { minimumLevelText } from '../../lib/minimum-level';
import { fieldForReason, groupCreateSchema } from '../../lib/schemas/group';
import { useFormValidation } from '../../lib/use-form-validation';
import type {
  AdminGroup,
  AppointableMember,
  RunGroupCommand,
} from '../../queries/groups-admin';
import { MemberName } from '../../components/member/MemberName';
import { MemberPicker } from './MemberPicker';
import {
  createdGroupManager,
  directManagerCandidates,
  CHILD_GROUP_CATEGORIES,
  GROUP_CATEGORIES,
  managerTitleFor,
  minLevelChoices,
  PRIVATE_GROUP_HINT,
} from './group-tree';

const labelClass = 'text-sm font-medium';
/** A label with its "i" at the end of the row. */
const labelRowClass = 'flex items-center justify-between gap-2';

/** The Minimum Level drop-down's first option: the parent's, or Recrut. */
const DEFAULT_MIN_LEVEL = 'default';

/**
 * Creating a Group, in a form sheet (a form of this many fields is never a
 * dialog). It opens from the page's plus button (`FabAction`). Only the
 * optional fields say so; what a field needs explained once sits behind the
 * "i" beside its label.
 *
 * The parent is chosen here and never again: a Group's place in the tree is
 * fixed at creation (ADR-0009, ruling R20), which is why there is no "Mută
 * grupul" control anywhere in Administrare.
 *
 * **Grup privat** mirrors `create_group` (#756): BC and the Moderator choose
 * it — for a top-level Group and for a Child Group of a public parent alike —
 * and a Child Group of a Private Group is private whatever is chosen, so the
 * box is shown ticked and locked. A Group Manager under a public parent is
 * not offered it: the server would refuse the private Child.
 *
 * **Manager direct** (#951): creating a Group never makes its creator the
 * Group Manager. The creator may name one, under the title the category
 * pre-fills, or leave it empty — the Group is then run from above (CONTEXT.md
 * Group Manager). The Moderator is never offered.
 */
export function GroupCreateDialog({
  trigger,
  title,
  parent,
  groups,
  groupsById,
  levels,
  actorLevel,
  members,
  disabled,
  choosePrivate,
  onCreate,
}: {
  trigger: string;
  title: string;
  /** Fixed parent (the Subgrupuri tab); `null` offers the picker. */
  parent: AdminGroup | null;
  groups: AdminGroup[];
  groupsById: ReadonlyMap<number, { name: string }>;
  levels: number[];
  actorLevel: number;
  members: AppointableMember[];
  disabled: boolean;
  /** BC or the Moderator (`createTopLevelGroups`): may start a Private Group. */
  choosePrivate: boolean;
  onCreate: RunGroupCommand;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(
    parent ? 'team' : 'department',
  );
  const [chosenParent, setChosenParent] = useState<AdminGroup | null>(null);
  const [minLevel, setMinLevel] = useState<string>('');
  const [color, setColor] = useState('');
  const [short, setShort] = useState('');
  const [manager, setManager] = useState<AppointableMember | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const form = useFormValidation(
    groupCreateSchema,
    {
      name,
      category,
      minLevel: minLevel === '' ? null : Number(minLevel),
      color,
      short,
    },
    fieldForReason,
  );

  const effectiveParent = parent ?? chosenParent;
  const inheritsPrivate = effectiveParent?.is_private === true;
  const privateChoice = inheritsPrivate || (choosePrivate && isPrivate);
  const choices = minLevelChoices(
    levels,
    effectiveParent?.min_level ?? 0,
    actorLevel,
  );
  // The direct Manager (#951) is chosen, never assumed: nobody by default,
  // and only among those `create_group` accepts at the new Group's Minimum
  // Level. A choice the Minimum Level rules out is dropped for good: a later
  // lowering does not bring it back unasked.
  const minLevelOf = (level: string, above: AdminGroup | null) =>
    level === '' ? (above?.min_level ?? 0) : Number(level);
  const managerChoices = directManagerCandidates(
    members,
    minLevelOf(minLevel, effectiveParent),
  );
  const chosenManager =
    managerChoices.find((member) => member.memberId === manager?.memberId) ??
    null;
  function dropIneligibleManager(nextMinLevel: number) {
    if (
      manager &&
      directManagerCandidates([manager], nextMinLevel).length === 0
    )
      setManager(null);
  }

  function reset() {
    setName('');
    setCategory(parent ? 'team' : 'department');
    setChosenParent(null);
    setMinLevel('');
    setColor('');
    setShort('');
    setManager(null);
    setIsPrivate(false);
    form.reset();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    const created = await onCreate(
      {
        kind: 'create',
        name: values.name,
        category: values.category,
        parentId: effectiveParent?.id ?? null,
        minLevel: values.minLevel,
        managerId: chosenManager?.memberId ?? null,
        color: values.color,
        short: values.short,
        isPrivate: privateChoice,
      },
      (failure) => form.fail(failure, 'Nu am putut crea grupul. Reîncearcă.'),
    );
    if (created) {
      setOpen(false);
      reset();
    }
  }

  const parentHint = parent
    ? `Grupul nou va face parte din ${parent.name}. Grupul părinte nu se mai poate schimba după creare.`
    : 'Grupul părinte nu se mai poate schimba după creare.';

  return (
    <>
      <FabAction
        label={trigger}
        icon={PlusIcon}
        onSelect={() => {
          if (disabled) return;
          reset();
          setOpen(true);
        }}
      />
      <FormSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) reset();
        }}
        title={title}
        busy={disabled}
      >
        <form
          onSubmit={submit}
          noValidate
          className="flex flex-1 flex-col gap-4"
        >
          <div className="grid gap-1.5">
            <div className={labelRowClass}>
              <label htmlFor={`${id}-name`} className={labelClass}>
                Numele grupului
              </label>
              {/* With the parent fixed there is no parent field to carry it. */}
              {parent && (
                <InfoHint
                  label="Despre grupul părinte"
                  id={`${id}-parent-hint`}
                >
                  {parentHint}
                </InfoHint>
              )}
            </div>
            <Input
              id={`${id}-name`}
              value={name}
              required
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
              {...form.field('name', parent ? `${id}-parent-hint` : undefined)}
            />
            <FieldError {...form.errorProps('name')} />
          </div>

          <div className="grid gap-1.5" {...form.slot('category')}>
            <span id={`${id}-category`} className={labelClass}>
              Categorie
            </span>
            <SegmentedRadio<string>
              aria-labelledby={`${id}-category`}
              aria-describedby={
                form.error('category') ? form.errorId('category') : undefined
              }
              options={
                effectiveParent ? CHILD_GROUP_CATEGORIES : GROUP_CATEGORIES
              }
              value={category}
              onValueChange={setCategory}
              disabled={disabled}
            />
            <FieldError {...form.errorProps('category')} />
          </div>

          {!parent && (
            <div className="grid gap-1.5">
              <div className={labelRowClass}>
                <span id="create-group-parent" className={labelClass}>
                  Grup părinte (opțional)
                </span>
                <InfoHint
                  label="Despre grupul părinte"
                  id={`${id}-parent-hint`}
                >
                  {parentHint}
                </InfoHint>
              </div>
              <GroupFilterCombobox
                ariaLabelledBy="create-group-parent"
                ariaDescribedBy={`${id}-parent-hint`}
                groups={groups}
                groupsById={groupsById}
                value={chosenParent}
                onValueChange={(next) => {
                  setChosenParent(next);
                  // Under a parent the Group is an Echipă or a Proiect.
                  if (next && category === 'department') setCategory('team');
                  dropIneligibleManager(minLevelOf(minLevel, next));
                }}
                placeholder="Fără grup părinte"
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <label htmlFor={`${id}-min-level`} className={labelClass}>
              Nivel minim
            </label>
            <Select
              id={`${id}-min-level`}
              value={minLevel || DEFAULT_MIN_LEVEL}
              options={[
                {
                  value: DEFAULT_MIN_LEVEL,
                  label: effectiveParent
                    ? `Ca grupul părinte (${minimumLevelText(effectiveParent.min_level)})`
                    : minimumLevelText(0),
                },
                ...choices
                  // A top-level Group's default is Recrut already: one option.
                  .filter((level) => effectiveParent || level !== 0)
                  .map((level) => ({
                    value: String(level),
                    label: minimumLevelText(level),
                  })),
              ]}
              disabled={disabled}
              onValueChange={(value) => {
                const next = value === DEFAULT_MIN_LEVEL ? '' : value;
                setMinLevel(next);
                dropIneligibleManager(minLevelOf(next, effectiveParent));
              }}
              {...form.field('minLevel')}
            />
            <FieldError {...form.errorProps('minLevel')} />
          </div>

          <div className="grid gap-1.5">
            <div className={labelRowClass}>
              <span id="create-group-manager" className={labelClass}>
                Manager direct — {managerTitleFor(category)} (opțional)
              </span>
              <InfoHint
                label="Despre managerul direct"
                id="create-group-manager-hint"
              >
                {effectiveParent
                  ? 'Fără el, grupul este condus de managerii grupurilor de deasupra.'
                  : 'Fără el, grupul este condus de BC și Moderator.'}
              </InfoHint>
            </div>
            <MemberPicker
              ariaLabelledBy="create-group-manager"
              ariaDescribedBy="create-group-manager-hint"
              members={managerChoices}
              value={chosenManager}
              onValueChange={setManager}
              noneLabel="Fără manager direct"
              disabled={disabled}
            />
          </div>

          {(choosePrivate || inheritsPrivate) && (
            <div className="grid gap-1">
              <div className={labelRowClass}>
                <ChoiceRow>
                  <Checkbox
                    checked={privateChoice}
                    disabled={disabled || inheritsPrivate}
                    aria-describedby={`${id}-private-hint`}
                    onCheckedChange={(checked) => setIsPrivate(checked)}
                  />
                  <span className={labelClass}>Grup privat</span>
                </ChoiceRow>
                {!inheritsPrivate && (
                  <InfoHint
                    label="Despre grupul privat"
                    id={`${id}-private-hint`}
                  >
                    {PRIVATE_GROUP_HINT}
                  </InfoHint>
                )}
              </div>
              {/* Why the box is ticked and locked: said in view. */}
              {inheritsPrivate && (
                <p
                  id={`${id}-private-hint`}
                  className="m-0 text-sm text-muted-foreground"
                >
                  {effectiveParent?.name ?? 'Grupul părinte'} este privat, deci
                  și grupul nou va fi privat.
                </p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <label htmlFor={`${id}-short`} className={labelClass}>
                Prescurtare (opțional)
              </label>
              <Input
                id={`${id}-short`}
                value={short}
                maxLength={16}
                disabled={disabled}
                onChange={(event) => setShort(event.target.value)}
                {...form.field('short')}
              />
              <FieldError {...form.errorProps('short')} />
            </div>
            <div
              className="grid content-start gap-1.5 sm:col-span-2"
              {...form.slot('color')}
            >
              <span className={labelClass}>Culoare (opțional)</span>
              <ColorPicker
                label="Alege culoarea grupului"
                noneLabel="Fără culoare"
                value={color}
                disabled={disabled}
                onChange={setColor}
              />
              <FieldError {...form.errorProps('color')} />
            </div>
          </div>

          <FieldError>{form.formError}</FieldError>

          <FormSheetFooter>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => setOpen(false)}
            >
              Renunță
            </Button>
            <Button type="submit" disabled={disabled}>
              Creează
            </Button>
          </FormSheetFooter>
        </form>
      </FormSheet>
    </>
  );
}

/**
 * The receipt after a Group is created (#951): the direct Manager appointed
 * with it, named through MemberName like every Member, under their title.
 */
export function GroupCreatedReceipt({
  manager,
}: {
  manager: ReturnType<typeof createdGroupManager>;
}) {
  if (!manager) return <>Grupul a fost creat.</>;
  return (
    <>
      Grupul a fost creat, cu{' '}
      <MemberName
        size="sm"
        memberId={manager.member.memberId}
        fullName={manager.member.name}
        nickname={manager.member.nickname}
        avatarColor={manager.member.avatarColor}
      />{' '}
      ca {manager.title}.
    </>
  );
}
