import { Select as SelectPrimitive } from '@base-ui/react/select';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from 'cn';

import { fieldControlClass } from '@/components/ui/input';

export type SelectOption<T extends string = string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

/**
 * The app's drop-down (DESIGN.md, "One field, one form"): the form's own
 * field surface with the up/down chevron, opening the same pop-over list the
 * Group picker uses — never the browser's or the phone's own picker, which
 * look like no other part of the app. For a short, fixed list of four
 * options or more; two or three are a `SegmentedRadio`, and a list worth
 * searching is a `Combobox`.
 *
 * Base UI owns the semantics: the field is a `combobox` named by its label
 * (`id` + `<label htmlFor>`, or `aria-label`), the list a `listbox` of
 * `option`s, with arrow keys, type-ahead and Escape. `name` submits the value
 * with a native form. An empty-string value shows the `placeholder`.
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  name,
  disabled,
  required,
  className,
  onBlur,
  ...trigger
}: Omit<
  ComponentProps<typeof SelectPrimitive.Trigger>,
  'value' | 'children'
> & {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: ReactNode;
  name?: string;
  required?: boolean;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      name={name}
      disabled={disabled}
      required={required}
    >
      <SelectPrimitive.Trigger
        data-slot="select"
        data-value={value}
        // Opening the list moves focus into it: that is not the member
        // leaving the field, so a form's on-blur validation waits.
        onBlur={(event) => {
          if (event.currentTarget.getAttribute('aria-expanded') !== 'true')
            onBlur?.(event);
        }}
        className={cn(
          fieldControlClass,
          'flex h-11 cursor-pointer items-center justify-between gap-2 text-left hover:bg-muted data-popup-open:bg-muted dark:hover:bg-input/50',
          className,
        )}
        {...trigger}
      >
        <span
          className={cn('min-w-0 truncate', !chosen && 'text-muted-foreground')}
        >
          {chosen ? chosen.label : placeholder}
        </span>
        <ChevronsUpDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          alignItemWithTrigger={false}
          sideOffset={4}
          collisionPadding={12}
          className="z-80 outline-none"
        >
          <SelectPrimitive.Popup className="max-h-[min(var(--available-height),20rem)] w-(--anchor-width) min-w-48 origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale] outline-none motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="flex min-h-11 cursor-default items-center justify-between gap-3 rounded-md px-3 py-2 text-sm outline-none select-none data-disabled:text-muted-foreground data-highlighted:bg-muted"
              >
                <SelectPrimitive.ItemText className="min-w-0">
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <CheckIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-primary"
                  />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
