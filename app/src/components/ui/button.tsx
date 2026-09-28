import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

// A disabled button keeps its shape and loses its colour: the muted surface
// and muted text keep the label readable (about 6:1 in both themes) where the
// old 50 % opacity faded the brand red to a muddy 2:1 (#842, X15). Base UI
// marks a disabled button with `data-disabled`; a native `disabled` element
// styled through `buttonVariants` matches the `disabled:` twin.
const disabledFilled =
  'disabled:border-border disabled:bg-muted disabled:text-muted-foreground data-disabled:border-border data-disabled:bg-muted data-disabled:text-muted-foreground';
const disabledBare =
  'disabled:text-muted-foreground data-disabled:text-muted-foreground';

const buttonVariants = cva(
  "group/button inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding font-sans text-sm font-medium whitespace-nowrap transition-all motion-reduce:transition-none outline-none select-none focus-visible:border-ring focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none data-disabled:pointer-events-none aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: `bg-primary text-primary-foreground hover:bg-red-600 hover:text-brand-white active:bg-red-700 active:text-brand-white ${disabledFilled}`,
        outline: `border-border bg-background text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 ${disabledFilled}`,
        secondary: `bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground ${disabledFilled}`,
        ghost: `hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50 ${disabledBare}`,
        destructive: `bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40 ${disabledFilled}`,
        link: `text-primary underline-offset-4 hover:underline ${disabledBare}`,
      },
      size: {
        default:
          'h-11 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xs: "h-11 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-12 gap-1.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4',
        icon: 'size-11',
        'icon-xs':
          "size-11 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          'size-11 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-12',
      },
      // A form submit: full width on a phone, where the thumb wants a wide
      // target, and its own width from `sm` up, where a 900 px bar reads as a
      // banner rather than a button (#842, X15).
      block: {
        true: 'w-full sm:w-auto',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
      block: false,
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  block = false,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, block, className }))}
      {...props}
    />
  );
}

// shadcn exports the variant builder so button groups can compose the exact
// same contract without duplicating classes.
// oxlint-disable-next-line react/only-export-components
export { Button, buttonVariants };
