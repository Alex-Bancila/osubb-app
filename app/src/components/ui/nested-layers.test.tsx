import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import {
  Sheet,
  SheetBackdrop,
  SheetDescription,
  SheetPopup,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from './sheet';

// #943: a dialog or sheet opened from inside a sheet dims the sheet beneath
// it. The nested layer renders its own backdrop, and that backdrop paints
// above the parent sheet: every backdrop and popup shares `z-70`, so the
// layer opened last (later in the document) is on top.

function DetailsWithDelete() {
  return (
    <Sheet>
      <SheetTrigger>Deschide anunțul</SheetTrigger>
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup side="right">
          <SheetTitle>Ședință de departament</SheetTitle>
          <SheetDescription>Detaliile anunțului.</SheetDescription>
          <Dialog>
            <DialogTrigger>Șterge</DialogTrigger>
            <DialogContent>
              <DialogTitle>Ștergi anunțul?</DialogTitle>
              <DialogDescription>Nu poate fi recuperat.</DialogDescription>
            </DialogContent>
          </Dialog>
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}

function DetailsWithEditSheet() {
  const [editing, setEditing] = useState(false);
  return (
    <Sheet>
      <SheetTrigger>Deschide anunțul</SheetTrigger>
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup side="right">
          <SheetTitle>Ședință de departament</SheetTitle>
          <button type="button" onClick={() => setEditing(true)}>
            Editează
          </button>
          <Sheet open={editing} onOpenChange={setEditing}>
            <SheetPortal>
              <SheetBackdrop />
              <SheetPopup side="right">
                <SheetTitle>Editează anunțul</SheetTitle>
              </SheetPopup>
            </SheetPortal>
          </Sheet>
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}

function follows(later: Element, earlier: Element) {
  return (
    (earlier.compareDocumentPosition(later) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  );
}

describe('a layer opened on top of a sheet (#943)', () => {
  it('dims the sheet beneath a nested dialog', async () => {
    const user = userEvent.setup();
    render(<DetailsWithDelete />);
    await user.click(screen.getByRole('button', { name: 'Deschide anunțul' }));
    const sheet = await screen.findByRole('dialog', {
      name: 'Ședință de departament',
    });

    await user.click(screen.getByRole('button', { name: 'Șterge' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'Ștergi anunțul?',
    });

    const sheetBackdrop = document.querySelector(
      '[data-slot="sheet-backdrop"]',
    );
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    // Base UI leaves a nested backdrop out unless it is forced to render.
    expect(sheetBackdrop).not.toBeNull();
    expect(overlay).not.toBeNull();

    // One z-index for every layer, so document order decides: the dialog's
    // backdrop comes after the sheet and before the dialog.
    for (const layer of [sheetBackdrop, sheet, overlay, confirm]) {
      expect(layer?.className).toContain('z-70');
    }
    if (!overlay) return;
    expect(follows(overlay, sheet)).toBe(true);
    expect(follows(confirm, overlay)).toBe(true);
  });

  it('keeps focus in the top layer and closes only it on Escape', async () => {
    const user = userEvent.setup();
    render(<DetailsWithDelete />);
    await user.click(screen.getByRole('button', { name: 'Deschide anunțul' }));
    await screen.findByRole('dialog', { name: 'Ședință de departament' });
    const trigger = screen.getByRole('button', { name: 'Șterge' });

    await user.click(trigger);
    const confirm = await screen.findByRole('dialog', {
      name: 'Ștergi anunțul?',
    });
    await waitFor(() =>
      expect(confirm).toContainElement(document.activeElement as HTMLElement),
    );

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Ștergi anunțul?' }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole('dialog', { name: 'Ședință de departament' }),
    ).toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('dims the sheet beneath a nested sheet', async () => {
    const user = userEvent.setup();
    render(<DetailsWithEditSheet />);
    await user.click(screen.getByRole('button', { name: 'Deschide anunțul' }));
    const details = await screen.findByRole('dialog', {
      name: 'Ședință de departament',
    });

    await user.click(screen.getByRole('button', { name: 'Editează' }));
    const edit = await screen.findByRole('dialog', {
      name: 'Editează anunțul',
    });

    const backdrops = document.querySelectorAll('[data-slot="sheet-backdrop"]');
    expect(backdrops).toHaveLength(2);
    const nested = backdrops.item(1);
    expect(follows(nested, details)).toBe(true);
    expect(follows(edit, nested)).toBe(true);
    expect(nested.className).toContain('z-70');
    expect(details.className).toContain('z-70');
    expect(nested.className).toContain('motion-reduce:transition-none');
  });
});
