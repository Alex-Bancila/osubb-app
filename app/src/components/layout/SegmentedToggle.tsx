import type { ReactNode } from 'react';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import type { LucideIcon } from 'lucide-react';
import { cn } from 'cn';
import { SlidingThumb, useSlidingThumb } from '../ui/sliding-thumb';
import { focusRingClass } from './focus';

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  /** A count beside the label; it stays when `compact` hides the label. */
  badge?: ReactNode;
};

/**
 * A choice between two or three views of the same content (Calendar's Lună /
 * Agendă): a Base UI `ToggleGroup` — a `role="group"` of buttons, the chosen
 * one `aria-pressed="true"`, arrow keys moving between them — on a track with
 * the radius of the buttons it sits beside. The ink under the chosen segment
 * is one thumb that slides to it. It is a view switch, not navigation —
 * routed choices are `PageTabs`.
 *
 * The whole toggle is 44 px tall, the height of every other control it sits
 * beside (layout X5): 36 px segments in a 3 px track with a 1 px border. Each
 * segment's hit area reaches 4 px above and below it (`after:-inset-y-1`),
 * so every segment is still a 44 px target.
 *
 * `compact` is for a toggle on the page header's row: under 640 px each
 * segment is its icon alone (the label stays its name), so every option
 * needs an `icon`.
 */
export function SegmentedToggle<T extends string>({
  label,
  options,
  value,
  onChange,
  compact = false,
  className,
}: {
  /** The group's accessible name ("Vizualizare"). */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  compact?: boolean;
  className?: string;
}) {
  // Where the chosen segment is, for the thumb. Unmeasured (the first paint,
  // a hidden toggle), the segment inks itself instead.
  const { track, thumb } = useSlidingThumb<HTMLDivElement>(
    '[aria-pressed="true"]',
  );

  return (
    <ToggleGroup
      ref={track}
      aria-label={label}
      data-slot="segmented-toggle"
      value={[value]}
      onValueChange={(pressed) => {
        // Pressing the chosen segment again leaves it chosen.
        const next = pressed[0];
        if (next !== undefined) onChange(next);
      }}
      className={cn(
        'relative inline-flex max-w-full gap-0.5 rounded-lg border border-border bg-(--surface-3) p-[3px]',
        className,
      )}
    >
      <SlidingThumb thumb={thumb} slot="segmented-thumb" />
      {options.map(({ value: option, label: text, icon: Icon, badge }) => (
        <Toggle
          key={option}
          value={option}
          className={cn(
            'relative z-1 inline-flex min-h-[36px] min-w-11 items-center justify-center gap-1.5 rounded-md text-sm font-bold whitespace-nowrap text-muted-foreground transition-colors duration-200 after:absolute after:inset-x-0 after:-inset-y-1 hover:text-foreground motion-reduce:transition-none aria-pressed:text-(--surface) aria-pressed:hover:text-(--surface) [&_svg]:size-4 [&_svg]:shrink-0',
            !thumb && 'aria-pressed:bg-(--text)',
            compact ? 'px-3 sm:px-4' : 'px-4',
            focusRingClass,
          )}
        >
          {Icon && <Icon aria-hidden="true" />}
          {compact ? <span className="max-sm:sr-only">{text}</span> : text}
          {badge}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
