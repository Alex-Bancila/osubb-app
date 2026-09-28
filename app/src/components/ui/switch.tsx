import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { useId, type ReactNode } from 'react';
import { cn } from 'cn';

// An on/off setting that takes effect at once, without a Save button. Base UI
// owns the semantics: role="switch", aria-checked, Space/Enter toggle, and a
// hidden checkbox for forms. Name it with `aria-labelledby` or `aria-label`,
// or put it in a `SwitchRow`, which names it for you.
//
// Off is an outlined track with a dark thumb, on is a filled brand track with
// a white thumb: the two states differ in fill and thumb side, not in colour
// alone. The off border is `--ink-400`, 3.4:1 against the light panel and
// 3.9:1 against the dark one (WCAG 1.4.11 asks 3:1; the old `--input` track
// reached 1.27:1 and 1.45:1). The track is 24 px tall; an invisible 44 px
// strip above and below keeps the touch target at 44 px (#842, X13).
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-ink-400 bg-muted transition-colors outline-none before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[''] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring motion-reduce:transition-none data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-muted-foreground shadow-sm transition-transform motion-reduce:transition-none data-checked:translate-x-[1.375rem] data-checked:bg-brand-white"
      />
    </SwitchPrimitive.Root>
  );
}

type SwitchRowProps = Omit<SwitchPrimitive.Root.Props, 'children'> & {
  /** What the switch turns on or off, in the member's words. */
  label: ReactNode;
  /** One line on what happens when it is on; muted, under the label. */
  description?: ReactNode;
  /** Classes for the whole row (the `label` element). */
  rowClassName?: string;
};

// A setting row: label, optional description and the switch in one `label`
// element, at least 44 px tall, so a click anywhere on the row toggles the
// switch. The switch is named by the label and described by the description.
function SwitchRow({
  label,
  description,
  rowClassName,
  id,
  ...props
}: SwitchRowProps) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const descriptionId = description ? `${baseId}-description` : undefined;
  return (
    <label
      data-slot="switch-row"
      className={cn(
        'flex min-h-11 cursor-pointer items-center justify-between gap-4 py-1.5 has-data-disabled:cursor-not-allowed',
        rowClassName,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </span>
        {description && (
          <span id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      <Switch
        id={id}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        {...props}
      />
    </label>
  );
}

export { Switch, SwitchRow };
