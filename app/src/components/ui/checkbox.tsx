import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { CheckIcon, MinusIcon } from 'lucide-react';
import { cn } from 'cn';

// A yes/no answer that is saved with its form (a setting that applies at once
// is a `Switch`). Base UI owns the semantics: role="checkbox", aria-checked
// (including "mixed"), Space toggles, and a hidden input carries the value.
// Put it in a `ChoiceRow` (from `radio-group`) so the text is part of the
// 44 px target. Same 20 px box, `--ink-400` edge and focus ring as the radio.
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer grid size-5 shrink-0 cursor-pointer place-items-center rounded-[5px] border-2 border-ink-400 bg-background text-brand-white transition-colors outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring motion-reduce:transition-none data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group/indicator grid place-items-center"
      >
        <CheckIcon
          aria-hidden="true"
          strokeWidth={3}
          className="size-3.5 group-data-indeterminate/indicator:hidden"
        />
        <MinusIcon
          aria-hidden="true"
          strokeWidth={3}
          className="hidden size-3.5 group-data-indeterminate/indicator:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
