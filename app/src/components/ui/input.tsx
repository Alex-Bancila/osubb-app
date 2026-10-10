import type { ComponentProps } from 'react';
import { cn } from 'cn';

/**
 * The one field surface (DESIGN.md, "One field, one form"): 44 px tall, the
 * outline button's border, background and radius, and the same focus ring —
 * what `Select`, the Combobox trigger and the date picker draw too, so
 * every control of a form reads as one kit. An invalid field takes the
 * destructive border and ring from `aria-invalid`.
 */
// oxlint-disable-next-line react/only-export-components
export const fieldControlClass =
  'w-full min-w-0 rounded-lg border border-border bg-background px-4 font-sans text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:border-input dark:bg-input/30';

/** A one-line text field. */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={cn(fieldControlClass, 'h-11', className)}
      {...props}
    />
  );
}

/** A text area: the same surface, as tall as its `rows`, resizable down. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldControlClass, 'min-h-24 resize-y py-2.5', className)}
      {...props}
    />
  );
}
