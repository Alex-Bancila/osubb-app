import type { DirectoryGroup } from '../../queries/member-directory';

/**
 * A member's Groups, kept to one readable line: the first few as chips, the
 * rest behind a "+N" that names them on hover and opens the full profile.
 */
export function MemberGroups({
  groups,
  max = 2,
  memberName,
  onShowAll,
}: {
  groups: DirectoryGroup[];
  max?: number;
  memberName: string;
  onShowAll: () => void;
}) {
  if (!groups.length) return <span className="text-muted-foreground">—</span>;
  const shown = groups.slice(0, max);
  const hidden = groups.slice(max);
  return (
    <ul className="flex min-w-0 flex-nowrap items-center gap-1">
      {shown.map((group) => (
        <li key={group.id} className="min-w-0 shrink">
          <span
            title={group.label}
            className="block max-w-32 truncate rounded-full border border-border px-2 py-0.5 text-xs font-medium"
          >
            {group.label}
          </span>
        </li>
      ))}
      {hidden.length > 0 && (
        <li className="shrink-0">
          <button
            type="button"
            onClick={onShowAll}
            title={hidden.map((group) => group.label).join('\n')}
            aria-label={`+${hidden.length} grupuri: ${hidden
              .map((group) => group.label)
              .join(', ')}. Vezi profilul membrului ${memberName}`}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 text-xs font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            +{hidden.length}
          </button>
        </li>
      )}
    </ul>
  );
}
