import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { GroupFilterCombobox } from '../../components/group/GroupFilterCombobox';
import type {
  AdminGroup,
  AppointableMember,
  GroupCommand,
} from '../../queries/groups-admin';
import { MemberPicker } from './MemberPicker';
import { GROUP_CATEGORIES, minLevelChoices } from './group-tree';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/**
 * Creating a Group, in a pop-up (dobre, 2026-09-21: a single-purpose action is
 * a dialog, not a page).
 *
 * The parent is chosen here and never again: a Group's place in the tree is
 * fixed at creation (ADR-0009, ruling R20), which is why there is no "Mută
 * grupul" control anywhere in Administrare.
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
  error,
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
  error: string | null;
  onCreate: (command: GroupCommand) => Promise<boolean>;
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
  const [attempted, setAttempted] = useState(false);

  const effectiveParent = parent ?? chosenParent;
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
    setAttempted(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setAttempted(true);
    const created = await onCreate({
      kind: 'create',
      name,
      category,
      parentId: effectiveParent?.id ?? null,
      minLevel: minLevel === '' ? null : Number(minLevel),
      managerId: manager?.memberId ?? null,
      color: color || null,
      short: short || null,
    });
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
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {parent
                ? `Grupul nou va face parte din ${parent.name}. Grupul părinte nu se mai poate schimba după creare.`
                : 'Grupul părinte nu se mai poate schimba după creare.'}
            </DialogDescription>
          </DialogHeader>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Numele grupului</span>
            <input
              className={control}
              value={name}
              required
              maxLength={120}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Categorie</span>
            <select
              className={control}
              value={category}
              disabled={disabled}
              onChange={(event) => setCategory(event.target.value)}
            >
              {GROUP_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

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

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Nivel minim</span>
            <select
              className={control}
              value={minLevel}
              disabled={disabled}
              onChange={(event) => setMinLevel(event.target.value)}
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

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Prescurtare</span>
              <input
                className={control}
                value={short}
                maxLength={16}
                disabled={disabled}
                onChange={(event) => setShort(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Culoare</span>
              <input
                className={control}
                value={color}
                placeholder="#C8102E"
                disabled={disabled}
                onChange={(event) => setColor(event.target.value)}
              />
            </label>
          </div>

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
            <Button type="submit" disabled={disabled || !name.trim()}>
              Creează
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
