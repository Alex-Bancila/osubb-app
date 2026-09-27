import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from 'cn';

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
};

/**
 * A choice between two or three views of the same content (Calendar's Lună /
 * Agendă): a `role="group"` of buttons on a pill track, the chosen one
 * `aria-pressed="true"` and inked. Every segment is a 44 px target. It is a
 * view switch, not navigation — routed choices are `PageTabs`.
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
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-(--text) aria-pressed:text-(--surface) [&_svg]:size-4 [&_svg]:shrink-0"
        >
          {Icon && <Icon aria-hidden="true" />}
          {text}
        </button>
      ))}
    </div>
  );
}
