import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from 'cn';
import { focusRingClass } from './focus';

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
};

/**
 * A choice between two or three views of the same content (Calendar's Lună /
 * Agendă): a `role="group"` of buttons on a pill track, the chosen one
 * `aria-pressed="true"` and inked. It is a view switch, not navigation —
 * routed choices are `PageTabs`.
 *
 * The whole toggle is 44 px tall, the height of every other control it sits
 * beside (layout X5): 36 px segments in a 3 px track with a 1 px border. Each
 * segment's hit area reaches 4 px above and below it (`after:-inset-y-1`),
 * so every segment is still a 44 px target.
 */
export function SegmentedToggle<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** The group's accessible name ("Vizualizare"). */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="segmented-toggle"
      className={cn(
        'inline-flex max-w-full gap-0.5 rounded-full border border-border bg-(--surface-3) p-[3px]',
        className,
      )}
    >
      {options.map(({ value: option, label: text, icon: Icon }) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'relative inline-flex min-h-[36px] min-w-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold whitespace-nowrap text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-1 hover:text-foreground aria-pressed:bg-(--text) aria-pressed:text-(--surface) [&_svg]:size-4 [&_svg]:shrink-0',
            focusRingClass,
          )}
        >
          {Icon && <Icon aria-hidden="true" />}
          {text}
        </button>
      ))}
    </div>
  );
}
