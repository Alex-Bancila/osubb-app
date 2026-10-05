import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Card } from './card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import {
  Sheet,
  SheetBackdrop,
  SheetFooter,
  SheetPopup,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from './sheet';

// #1013: with a phone keyboard open, every sheet and dialog ends at the
// keyboard, scrolls inside itself, and pins its footer just above it. The
// geometry is CSS (`--keyboard-inset`, `--visible-height`, the `keyboard:`
// variant and `[data-keyboard-pin]`, set by lib/keyboard-inset.ts); these
// assertions pin the classes and attributes that wire each part to it.

async function openDialog(fullScreenOnPhone = false) {
  const user = userEvent.setup();
  render(
    <Dialog>
      <DialogTrigger>Deschide</DialogTrigger>
      <DialogContent fullScreenOnPhone={fullScreenOnPhone}>
        <DialogTitle>Task nou</DialogTitle>
        <form>
          <input aria-label="Titlu" />
          <DialogFooter>
            <button type="submit">Creează taskul</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>,
  );
  await user.click(screen.getByRole('button', { name: 'Deschide' }));
  return screen.findByRole('dialog');
}

describe('a dialog above a phone keyboard (#1013)', () => {
  it('centres in the area above the keyboard and never outgrows it', async () => {
    const dialog = await openDialog();

    expect(dialog).toHaveClass(
      'top-[calc((100%-var(--keyboard-inset))/2)]',
      'max-h-[calc(var(--visible-height)-2rem)]',
      'overflow-y-auto',
    );
    expect(dialog).not.toHaveClass('top-1/2');
  });

  it('pins its footer above the keyboard', async () => {
    await openDialog();

    const footer = document.querySelector('[data-slot="dialog-footer"]');
    expect(footer).toHaveAttribute('data-keyboard-pin');
    expect(footer).toContainElement(
      screen.getByRole('button', { name: 'Creează taskul' }),
    );
  });

  it('fills the screen above the keyboard on a phone when asked', async () => {
    const dialog = await openDialog(true);

    expect(dialog).toHaveClass(
      'max-sm:top-0',
      'max-sm:h-(--visible-height)',
      'max-sm:max-h-none',
      'max-sm:rounded-none',
    );
    expect(dialog.className).not.toContain('h-dvh');
  });

  it('stays a centred dialog unless asked to fill the screen', async () => {
    const dialog = await openDialog();

    expect(dialog.className).not.toContain('max-sm:h-');
  });
});

describe('a sheet above a phone keyboard (#1013)', () => {
  async function openSheet(side: 'left' | 'right') {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Deschide</SheetTrigger>
        <SheetPortal>
          <SheetBackdrop />
          <SheetPopup side={side}>
            <SheetTitle>Editează profilul</SheetTitle>
            <SheetFooter>
              <button type="submit">Salvează modificările</button>
            </SheetFooter>
          </SheetPopup>
        </SheetPortal>
      </Sheet>,
    );
    await user.click(screen.getByRole('button', { name: 'Deschide' }));
    return screen.findByRole('dialog');
  }

  it.each(['left', 'right'] as const)(
    'ends where the keyboard starts (%s)',
    async (side) => {
      const sheet = await openSheet(side);

      expect(sheet).toHaveClass('top-0', 'bottom-(--keyboard-inset)');
      expect(sheet).not.toHaveClass('inset-y-0');
    },
  );

  it('scrolls its body and pins its footer above the keyboard', async () => {
    const sheet = await openSheet('right');

    expect(sheet).toHaveClass('overflow-y-auto');
    expect(
      document.querySelector('[data-slot="sheet-footer"]'),
    ).toHaveAttribute('data-keyboard-pin');
  });
});

describe('a card holding a form (#1013)', () => {
  it('clips without becoming a scroll container, so its actions can pin', () => {
    render(<Card data-testid="card" />);

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('overflow-clip');
    expect(card).not.toHaveClass('overflow-hidden');
  });
});
