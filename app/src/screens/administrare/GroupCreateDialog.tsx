import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { GroupFilterCombobox } from '../../components/group/GroupFilterCombobox';
import { fieldForReason, groupCreateSchema } from '../../lib/schemas/group';
import { useFormValidation } from '../../lib/use-form-validation';
import type {
  AdminGroup,
  AppointableMember,
  RunGroupCommand,
} from '../../queries/groups-admin';
import { MemberPicker } from './MemberPicker';
import {
  GROUP_CATEGORIES,
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
        managerId: manager?.memberId ?? null,
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
              <select
                className={control}
                value={category}
                disabled={disabled}
                onChange={(event) => setCategory(event.target.value)}
                {...form.field('category')}
              >
                {GROUP_CATEGORIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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
                onValueChange={setChosenParent}
                placeholder="Fără grup părinte"
              />
            </div>
          )}

          <div className="grid gap-1.5">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Nivel minim</span>
              <select
                className={control}
                value={minLevel}
                disabled={disabled}
                onChange={(event) => setMinLevel(event.target.value)}
                {...form.field('minLevel')}
              >
                <option value="">
                  {effectiveParent
                    ? `Ca grupul părinte (${effectiveParent.min_level})`
                    : 'Oricine (0)'}
                </option>
                {choices.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <FieldError {...form.errorProps('minLevel')} />
          </div>

          <div className="grid gap-1.5">
            <span id="create-group-manager" className="text-sm font-medium">
              Coordonator
            </span>
            <MemberPicker
              ariaLabelledBy="create-group-manager"
              members={members}
              value={manager}
              onValueChange={setManager}
              placeholder="Fără coordonator deocamdată"
              disabled={disabled}
            />
          </div>

          {(choosePrivate || inheritsPrivate) && (
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 size-5 shrink-0"
                checked={privateChoice}
                disabled={disabled || inheritsPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
              />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">Grup privat</span>
                <span className="text-sm text-muted-foreground">
                  {inheritsPrivate
                    ? `${effectiveParent?.name ?? 'Grupul părinte'} este privat, deci și grupul nou va fi privat.`
                    : PRIVATE_GROUP_HINT}
                </span>
              </span>
            </label>
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
