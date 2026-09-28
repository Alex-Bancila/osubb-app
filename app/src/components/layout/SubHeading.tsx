import { type ReactNode } from 'react';
import { cn } from 'cn';

export type SubHeadingVariant = 'eyebrow' | 'label';

const variants: Record<SubHeadingVariant, string> = {
  // The SectionHeader eyebrow: 11.5 px, 800, uppercase, muted.
  eyebrow:
    'text-[length:var(--fs-xs)] font-extrabold tracking-[0.08em] text-muted-foreground uppercase',
  // A 14 px / 600 label in the text colour.
  label: 'text-sm font-semibold text-foreground',
};

/**
 * The title of a block inside a panel or a dialog ("Grupuri", "Contact",
 * "Rol organizațional"), layout X10.
 *
 * Rules:
 * - Never larger than the 19 px section title above it: the eyebrow style
 *   (11.5 px / 800, uppercase — the default) or a 14 px / 600 `label`.
 * - An `h3` by default (an `h4` under an `h3` panel); no margin of its own —
 *   the stack it sits in spaces it.
 */
export function SubHeading({
  as: Heading = 'h3',
  variant = 'eyebrow',
  id,
  className,
  children,
}: {
  as?: 'h3' | 'h4' | 'p';
  variant?: SubHeadingVariant;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Heading
      id={id}
      data-slot="sub-heading"
      data-variant={variant}
      className={cn('m-0 leading-snug', variants[variant], className)}
    >
      {children}
    </Heading>
  );
}
