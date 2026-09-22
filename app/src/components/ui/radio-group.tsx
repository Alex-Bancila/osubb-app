import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import type { ComponentProps } from 'react';
import { cn } from 'cn';

// One choice out of a few. Base UI owns the radio semantics: arrow keys move
// between options, Tab leaves the group, and the checked value is submitted
// with the form through a hidden input.
function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn('grid gap-2', className)}
      {...props}
    />
  );
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        'grid aspect-square size-5 shrink-0 place-items-center rounded-full border-2 border-input bg-background transition-colors outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:border-primary data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="size-2.5 rounded-full bg-primary"
      />
    </RadioPrimitive.Root>
  );
}

// A whole-row option: the label is the click target, the brand border and
// tint mark the selected row, and the focus ring follows the keyboard.
function RadioCard({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      data-slot="radio-card"
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-input px-3 py-2 transition-colors hover:bg-muted/60 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[[data-disabled]]:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  );
}

export { RadioCard, RadioGroup, RadioGroupItem };
