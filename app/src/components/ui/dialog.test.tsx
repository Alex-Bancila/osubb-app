import * as axe from 'axe-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';

function RenameDialog() {
  return (
    <Dialog>
      <DialogTrigger>Redenumește</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redenumește grupul</DialogTitle>
          <DialogDescription>Numele apare în tot OSUBB.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose>Renunță</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('opens a small labelled pop-up and returns focus to the trigger on Escape', async () => {
    const user = userEvent.setup();
    render(<RenameDialog />);
    const trigger = screen.getByRole('button', { name: 'Redenumește' });

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', {
      name: 'Redenumește grupul',
    });
    expect(dialog).toHaveAccessibleDescription('Numele apare în tot OSUBB.');
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content');
    expect(dialog.className).toContain('max-w-');

    const results = await axe.run(dialog, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('offers a Romanian close button in the corner', async () => {
    const user = userEvent.setup();
    render(<RenameDialog />);
    const trigger = screen.getByRole('button', { name: 'Redenumește' });

    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Închide' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('closes from a 44 px X icon button named "Închide", no text button (#842)', async () => {
    const user = userEvent.setup();
    render(<RenameDialog />);
    await user.click(screen.getByRole('button', { name: 'Redenumește' }));
    await screen.findByRole('dialog');

    const close = document.querySelector<HTMLElement>(
      '[data-slot="dialog-content"] > [data-slot="dialog-close"]',
    );
    expect(close).not.toBeNull();
    expect(close).toHaveAttribute('aria-label', 'Închide');
    // Icon only: the visible content is the X, the name is the label.
    expect(close?.textContent).toBe('');
    expect(close?.querySelector('svg')).not.toBeNull();
    expect(close?.className).toContain('size-11');
  });

  it('sets one title size and description style (#842)', async () => {
    const user = userEvent.setup();
    render(<RenameDialog />);
    await user.click(screen.getByRole('button', { name: 'Redenumește' }));
    await screen.findByRole('dialog');

    const title = screen.getByText('Redenumește grupul');
    expect(title.className).toContain('text-(length:--fs-lg)');
    expect(title.className).toContain('font-bold');
    expect(title.className).toContain('m-0');
    const description = screen.getByText('Numele apare în tot OSUBB.');
    expect(description.className).toContain('text-sm');
    expect(description.className).toContain('text-muted-foreground');
  });

  it('stacks the footer under sm and puts the primary last and right from sm (#842)', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Deschide</DialogTrigger>
        <DialogContent>
          <DialogTitle>Grup nou</DialogTitle>
          <DialogFooter>
            <DialogClose>Renunță</DialogClose>
            <button type="submit">Creează grupul</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Deschide' }));
    await screen.findByRole('dialog');

    const footer = document.querySelector('[data-slot="dialog-footer"]');
    expect(footer?.className).toContain('flex-col-reverse');
    expect(footer?.className).toContain('sm:flex-row');
    expect(footer?.className).toContain('sm:justify-end');
    expect(footer?.lastElementChild).toHaveTextContent('Creează grupul');
  });

  it('can leave the corner close button out', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Deschide</DialogTrigger>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Confirmare</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole('button', { name: 'Deschide' }));
    await screen.findByRole('dialog', { name: 'Confirmare' });
    expect(screen.queryByRole('button', { name: 'Închide' })).toBeNull();
  });

  it('opens without its scale and fade under reduced motion (#219)', async () => {
    const user = userEvent.setup();
    render(<RenameDialog />);
    await user.click(screen.getByRole('button', { name: 'Redenumește' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toContain('motion-reduce:transition-none');
    expect(
      document.querySelector('[data-slot="dialog-overlay"]')?.className,
    ).toContain('motion-reduce:transition-none');
  });
});
