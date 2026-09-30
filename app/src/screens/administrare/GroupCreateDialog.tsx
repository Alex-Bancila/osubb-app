import { useState, type FormEvent } from 'react';
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
  GROUP_CATEGORIES,
  managerTitleFor,
  minLevelChoices,
  PRIVATE_GROUP_HINT,
} from './group-tree';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/**
 * Creating a Group, in a pop-up (dobre, 2026-09-21: a single-purpose action is
 * a dialog, not a page).
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
  /** Fixed parent (the Grupuri copil tab); `null` offers the picker. */
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (next) reset();
      }}
    >
      <Button
        type="button"
        disabled={disabled}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {parent
                ? `Grupul nou va face parte din ${parent.name}. Grupul părinte nu se mai poate schimba după creare.`
                : 'Grupul părinte nu se mai poate schimba după creare.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Numele grupului</span>
              <input
                className={control}
                value={name}
                required
                disabled={disabled}
                onChange={(event) => setName(event.target.value)}
                {...form.field('name')}
              />
            </label>
            <FieldError {...form.errorProps('name')} />
          </div>

          <div className="grid gap-1.5">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Categorie</span>
              <NativeSelect
                value={category}
                disabled={disabled}
                onChange={(event) => setCategory(event.target.value)}
                {...form.field('category')}
              >
                {GROUP_CATEGORIES.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <FieldError {...form.errorProps('category')} />
          </div>

          {!parent && (
            <div className="grid gap-1.5">
              <span id="create-group-parent" className="text-sm font-medium">
                Grup părinte
              </span>
              <GroupFilterCombobox
                ariaLabelledBy="create-group-parent"
                groups={groups}
                groupsById={groupsById}
                value={chosenParent}
                onValueChange={(next) => {
                  setChosenParent(next);
                  dropIneligibleManager(minLevelOf(minLevel, next));
                }}
                placeholder="Fără grup părinte"
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Nivel minim</span>
              <NativeSelect
                value={minLevel}
                disabled={disabled}
                onChange={(event) => {
                  setMinLevel(event.target.value);
                  dropIneligibleManager(
                    minLevelOf(event.target.value, effectiveParent),
                  );
                }}
                {...form.field('minLevel')}
              >
                <NativeSelectOption value="">
                  {effectiveParent
                    ? `Ca grupul părinte (${minimumLevelText(effectiveParent.min_level)})`
                    : minimumLevelText(0)}
                </NativeSelectOption>
                {choices
                  // A top-level Group's default is Recrut already: one option.
                  .filter((level) => effectiveParent || level !== 0)
                  .map((level) => (
                    <NativeSelectOption key={level} value={level}>
                      {minimumLevelText(level)}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </label>
            <FieldError {...form.errorProps('minLevel')} />
          </div>

          <div className="grid gap-1.5">
            <span id="create-group-manager" className="text-sm font-medium">
              Manager direct ({managerTitleFor(category)})
            </span>
            <MemberPicker
              ariaLabelledBy="create-group-manager"
              ariaDescribedBy="create-group-manager-hint"
              members={managerChoices}
              value={chosenManager}
              onValueChange={setManager}
              noneLabel="Fără manager direct"
              disabled={disabled}
            />
            <p
              id="create-group-manager-hint"
              className="text-sm text-muted-foreground"
            >
              {effectiveParent
                ? 'Opțional. Fără el, grupul este condus de managerii grupurilor de deasupra.'
                : 'Opțional. Fără el, grupul este condus de BC și Moderator.'}
            </p>
          </div>

          {(choosePrivate || inheritsPrivate) && (
            <ChoiceRow className="items-start">
              <Checkbox
                className="mt-0.5"
                checked={privateChoice}
                disabled={disabled || inheritsPrivate}
                onCheckedChange={(checked) => setIsPrivate(checked)}
              />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">Grup privat</span>
                <span className="text-sm text-muted-foreground">
                  {inheritsPrivate
                    ? `${effectiveParent?.name ?? 'Grupul părinte'} este privat, deci și grupul nou va fi privat.`
                    : PRIVATE_GROUP_HINT}
                </span>
              </span>
            </ChoiceRow>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Prescurtare</span>
                <input
                  className={control}
                  value={short}
                  maxLength={16}
                  disabled={disabled}
                  onChange={(event) => setShort(event.target.value)}
                  {...form.field('short')}
                />
              </label>
              <FieldError {...form.errorProps('short')} />
            </div>
            <div className="grid gap-1.5">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">Culoare</span>
                <input
                  className={control}
                  value={color}
                  placeholder="#C8102E"
                  disabled={disabled}
                  onChange={(event) => setColor(event.target.value)}
                  {...form.field('color')}
                />
              </label>
              <FieldError {...form.errorProps('color')} />
            </div>
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
            <Button type="submit" disabled={disabled}>
              Creează
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
