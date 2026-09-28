import { ChevronsUpDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from 'cn';

// One select look for the whole app (#842, X12). Which one to use:
//
// - `NativeSelect` for a short, fixed list the member reads at a glance
//   (Mod de atribuire, Campanie, Stare, Ordonează, Tip, Cine îl vede): the
//   phone opens its own picker, and the value submits with the form.
// - `Combobox` for a list worth searching (members, Groups): it types to
//   narrow, and shows avatars or a parent Group beside each option.
//
// Both draw the same field: 44 px tall, the outline button's border,
// background and radius, the text on the left and the same up/down chevron
// 16 px from the right edge — so the two sit side by side in one form without
// looking like two kits.
function NativeSelect({
  className,
  wrapperClassName,
  ...props
}: ComponentProps<'select'> & {
  /** Classes for the wrapper that positions the chevron (width, grid span). */
  wrapperClassName?: string;
}) {
  return (
    <div
      data-slot="native-select-wrapper"
      className={cn('relative w-full', wrapperClassName)}
    >
      <select
        data-slot="native-select"
        className={cn(
          'h-11 w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg border border-border bg-background py-0 pr-10 pl-4 font-sans text-sm font-normal text-foreground transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none disabled:pointer-events-none disabled:border-border disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:border-input dark:bg-input/30 dark:hover:bg-input/50 [&>option]:bg-popover [&>option]:text-popover-foreground',
          className,
        )}
        {...props}
      />
      <ChevronsUpDownIcon
        aria-hidden="true"
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

function NativeSelectOption(props: ComponentProps<'option'>) {
  return <option data-slot="native-select-option" {...props} />;
}

function NativeSelectOptGroup(props: ComponentProps<'optgroup'>) {
  return <optgroup data-slot="native-select-optgroup" {...props} />;
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
