import type { PrimaryGroup } from '../../queries/member-directory';

/**
 * A member's Groups, kept to one readable line (R17): the earliest-joined
 * top-level Group as one chip in its own colour, and "+n" for every other
 * explicit membership. Both the chip and "+n" open the Member Card.
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
        className="inline-flex min-h-11 max-w-32 shrink items-center gap-1.5 truncate rounded-full border px-2.5 py-0.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-ring"
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
          style={{ backgroundColor: primaryGroup.color ?? 'var(--brand-red)' }}
        />
        <span className="truncate">{primaryGroup.name}</span>
      </button>
      {otherMemberships > 0 && (
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-label={`${
            otherMemberships === 1 ? '+1 grup' : `+${otherMemberships} grupuri`
          }. Vezi profilul membrului ${memberName}`}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          +{otherMemberships}
        </button>
      )}
    </span>
  );
}
