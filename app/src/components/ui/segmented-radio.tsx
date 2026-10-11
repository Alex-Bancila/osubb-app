import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';
import { cn } from 'cn';
import { SlidingThumb, useSlidingThumb } from './sliding-thumb';

export type SegmentedRadioOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

/**
 * One choice out of two or three, in a form (DESIGN.md, "One field, one
 * form"): the look of the page's view switch, with a radio group's meaning —
 * `role="radiogroup"`, each segment a `radio`, arrow keys between them, the
 * value submitted with the form. Four options or more are a select; a choice
 * that needs explaining gets an `InfoHint` beside its label, not a paragraph
 * in the control. The ink under the chosen segment is one thumb that slides
 * to it, as on every other pill track.
 */
export function SegmentedRadio<T extends string>({
  options,
  value,
  onValueChange,
  className,
  ...props
}: Omit<RadioGroup.Props, 'value' | 'onValueChange' | 'children'> & {
  options: readonly SegmentedRadioOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
}) {
  const { track, thumb } = useSlidingThumb<HTMLDivElement>(
    '[aria-checked="true"]',
  );
  return (
    <RadioGroup
      ref={track}
      data-slot="segmented-radio"
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      className={cn(
        'relative flex w-full gap-0.5 rounded-lg border border-border bg-(--surface-3) p-[3px]',
        className,
      )}
      {...props}
    >
      <SlidingThumb thumb={thumb} slot="segmented-thumb" />
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            'relative z-1 inline-flex min-h-[36px] min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md px-3 text-center text-sm leading-tight font-bold text-muted-foreground transition-colors duration-200 outline-none after:absolute after:inset-x-0 after:-inset-y-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring motion-reduce:transition-none data-checked:text-(--surface) data-checked:hover:text-(--surface) data-disabled:cursor-not-allowed data-disabled:opacity-50',
            !thumb && 'data-checked:bg-(--text)',
          )}
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
