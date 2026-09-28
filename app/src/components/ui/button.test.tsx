import * as axe from 'axe-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button, buttonVariants } from './button';

describe('Button', () => {
  it('renders an accessible Base UI button with the OSUBB interaction contract', async () => {
    const user = userEvent.setup();
    const { container } = render(<Button>Trimite linkul</Button>);
    const button = screen.getByRole('button', { name: 'Trimite linkul' });

    expect(button).toHaveAttribute('data-slot', 'button');
    expect(buttonVariants()).toContain('min-h-11');
    expect(buttonVariants()).toContain('min-w-11');
    expect(buttonVariants()).toContain('font-sans');
    expect(buttonVariants()).toContain('focus-visible:ring-3');

    await user.tab();
    expect(button).toHaveFocus();

    const results = await axe.run(container, {
      // jsdom has no canvas-backed color calculation. The production-browser
      // check below covers computed colors and contrast; keep axe focused on
      // the semantic rules it can execute faithfully in this environment.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('drops its transition and press movement under reduced motion (#219)', () => {
    expect(buttonVariants()).toContain('motion-reduce:transition-none');
    expect(buttonVariants()).toContain(
      'motion-safe:active:not-aria-[haspopup]:translate-y-px',
    );
    expect(buttonVariants()).not.toMatch(/(^| )active:not-aria/);
  });

  it('shows a disabled button on the muted surface, never faded (#842)', () => {
    render(<Button disabled>Trimite cererea</Button>);
    const button = screen.getByRole('button', { name: 'Trimite cererea' });
    expect(button).toBeDisabled();

    for (const variant of [
      'default',
      'outline',
      'secondary',
      'ghost',
      'destructive',
      'link',
    ] as const) {
      const classes = buttonVariants({ variant });
      expect(classes).not.toMatch(/opacity/);
      expect(classes).toContain('disabled:text-muted-foreground');
      expect(classes).toContain('data-disabled:text-muted-foreground');
    }
    expect(button.className).toContain('data-disabled:bg-muted');
    expect(button.className).not.toMatch(/opacity/);
  });

  it('is full width on a phone and its own width from sm when block (#842)', () => {
    render(
      <>
        <Button block>Salvează numele</Button>
        <Button>Renunță</Button>
      </>,
    );
    const block = screen.getByRole('button', { name: 'Salvează numele' });
    expect(block.className).toContain('w-full');
    expect(block.className).toContain('sm:w-auto');
    expect(buttonVariants({ block: true })).toContain('w-full sm:w-auto');

    const plain = screen.getByRole('button', { name: 'Renunță' });
    expect(plain.className).not.toContain('w-full');
    expect(plain).not.toHaveAttribute('block');
  });
});
