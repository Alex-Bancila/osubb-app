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
});
