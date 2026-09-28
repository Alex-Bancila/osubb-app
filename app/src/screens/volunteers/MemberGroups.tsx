import type { PrimaryGroup } from '../../queries/member-directory';

/**
 * A member's Groups, kept to one readable line (R17): the earliest-joined
 * top-level Group as one chip in its own colour, and "+n" for every other
 * explicit membership. Both the chip and "+n" open the Member Card.
 *
 * The chip is drawn 24 px tall, a label beside a 16 px name; its 44 px hit
 * area is the button's padding around it, not the chip (layout L2). The
 * focus ring follows the chip.
 */
export function MemberGroups({
  primaryGroup,
  otherMemberships,
  memberName,
  onOpen,
}: {
  primaryGroup: PrimaryGroup | null;
  otherMemberships: number;
  memberName: string;
  onOpen: () => void;
}) {
  if (!primaryGroup) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 flex-nowrap items-center gap-1.5">
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={`Grupul ${primaryGroup.name}. Vezi profilul membrului ${memberName}`}
        className="group/chip inline-flex min-h-11 max-w-32 min-w-11 shrink items-center outline-none"
      >
        <span
          data-slot="group-chip"
          className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold group-focus-visible/chip:outline-2 group-focus-visible/chip:outline-offset-2 group-focus-visible/chip:outline-ring group-focus-visible/chip:outline-solid"
          style={{
            borderColor: primaryGroup.color ?? 'var(--border)',
            backgroundColor: primaryGroup.color
              ? `color-mix(in oklab, ${primaryGroup.color} 12%, transparent)`
              : undefined,
          }}
        >
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{
              backgroundColor: primaryGroup.color ?? 'var(--brand-red)',
            }}
          />
          <span className="truncate">{primaryGroup.name}</span>
        </span>
      </button>
      {otherMemberships > 0 && (
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-label={`${
            otherMemberships === 1 ? '+1 grup' : `+${otherMemberships} grupuri`
          }. Vezi profilul membrului ${memberName}`}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring"
        >
          +{otherMemberships}
        </button>
      )}
    </span>
  );
}
