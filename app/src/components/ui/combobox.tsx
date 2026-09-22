import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react';
import { cn } from 'cn';

import { buttonVariants } from '@/components/ui/button';
import { initials } from '@/lib/format';

// A dropdown whose search box lives inside the pop-up: the trigger looks like
// a field, the member types to narrow the list, arrows move the highlight and
// Enter picks. Base UI owns the listbox semantics (`aria-activedescendant`,
// Escape, focus returning to the trigger), so these parts only add styling.
const Combobox = ComboboxPrimitive.Root;

function ComboboxValue(props: ComboboxPrimitive.Value.Props) {
  return <ComboboxPrimitive.Value {...props} />;
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        buttonVariants({ variant: 'outline' }),
        'w-full justify-between font-normal data-popup-open:bg-muted',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronsUpDownIcon
        aria-hidden="true"
        className="text-muted-foreground"
      />
    </ComboboxPrimitive.Trigger>
  );
}

function ComboboxContent({
  className,
  children,
  sideOffset = 4,
  align = 'start',
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, 'sideOffset' | 'align'>) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        className="z-80 outline-none"
        sideOffset={sideOffset}
        align={align}
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            'flex max-h-[min(var(--available-height),24rem)] w-(--anchor-width) min-w-64 flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale] motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <div
      data-slot="combobox-search"
      className="flex items-center gap-2 border-b border-border px-3"
    >
      <SearchIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        className={cn(
          'h-11 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        'overflow-y-auto overscroll-contain p-1 empty:hidden',
        className,
      )}
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        'relative flex min-h-11 cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted data-highlighted:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <CheckIcon aria-hidden="true" className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

function ComboboxEmpty({
  className,
  children = 'Niciun rezultat',
  ...props
}: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        'px-3 py-4 text-center text-sm text-muted-foreground empty:hidden',
        className,
      )}
      {...props}
    >
      {children}
    </ComboboxPrimitive.Empty>
  );
}

// Rows stay light: a list of a hundred members must never pull a hundred
// full-size photos, so the avatar is a small circle and the only image it can
// load is a thumbnail declared at exactly that size.
const MEMBER_AVATAR_PX = 28;

type MemberAvatarProps = {
  name: string;
  avatarColor?: string | null;
  avatarUrl?: string | null;
  className?: string;
};

function MemberAvatar({
  name,
  avatarColor,
  avatarUrl,
  className,
}: MemberAvatarProps) {
  return (
    <span
      data-slot="member-avatar"
      aria-hidden="true"
      className={cn(
        'grid size-7 shrink-0 place-items-center overflow-hidden rounded-full text-[0.65rem] font-bold text-white',
        className,
      )}
      style={{ background: avatarColor ?? 'var(--brand-red)' }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          width={MEMBER_AVATAR_PX}
          height={MEMBER_AVATAR_PX}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}

function MemberOption({
  name,
  avatarColor,
  avatarUrl,
  className,
}: MemberAvatarProps) {
  return (
    <span
      data-slot="member-option"
      className={cn('flex min-w-0 items-center gap-2', className)}
    >
      <MemberAvatar
        name={name}
        avatarColor={avatarColor}
        avatarUrl={avatarUrl}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** The part of a Group an option needs; `path` ends with the Group's own id. */
type GroupOptionGroup = {
  id: number;
  name: string;
  path: readonly number[];
};

type GroupLookup = ReadonlyMap<number, Pick<GroupOptionGroup, 'name'>>;

/** The direct parent of a Child Group, when it is in the lookup. */
function groupParentName(
  group: GroupOptionGroup,
  groupsById: GroupLookup,
): string | undefined {
  const parentId = group.path.at(-2);
  return parentId === undefined ? undefined : groupsById.get(parentId)?.name;
}

/**
 * `Name · Parent` for a Child Group, `Name` for a top-level one — the text
 * that tells two teams with the same name apart, and the string the search
 * box matches against.
 */
function groupOptionLabel(
  group: GroupOptionGroup,
  groupsById: GroupLookup,
): string {
  const parent = groupParentName(group, groupsById);
  return parent ? `${group.name} · ${parent}` : group.name;
}

function GroupOption({
  group,
  groupsById,
  className,
}: {
  group: GroupOptionGroup;
  groupsById: GroupLookup;
  className?: string;
}) {
  const parent = groupParentName(group, groupsById);
  return (
    <span
      data-slot="group-option"
      className={cn('flex min-w-0 items-baseline gap-1', className)}
    >
      <span className="truncate">{group.name}</span>
      {parent && (
        <span className="truncate text-xs text-muted-foreground">
          <span aria-hidden="true">· </span>
          {parent}
        </span>
      )}
    </span>
  );
}

export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  GroupOption,
  MemberAvatar,
  MemberOption,
  // Exported beside the components so pickers feed the same text to
  // `itemToStringLabel` and the search filter.
  // oxlint-disable-next-line react/only-export-components
  groupOptionLabel,
  type GroupOptionGroup,
};
