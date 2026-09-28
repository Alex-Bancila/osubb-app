import * as axe from 'axe-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';
import { ComboboxTrigger, Combobox } from './combobox';
import { NativeSelect, NativeSelectOption } from './native-select';
import { ChoiceRow, RadioGroup, RadioGroupItem } from './radio-group';
import {
  Sheet,
  SheetBackdrop,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from './sheet';
import { Switch, SwitchRow } from './switch';

const axeOptions = { rules: { 'color-contrast': { enabled: false } } };

describe('Switch and SwitchRow (#842)', () => {
  it('toggles when the row label is clicked, and is named and described by it', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SwitchRow
        label="Taskuri noi"
        description="Primești o notificare când apare un task pentru tine."
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'Taskuri noi' });
    expect(toggle).toHaveAccessibleDescription(
      'Primești o notificare când apare un task pentru tine.',
    );
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(screen.getByText('Taskuri noi'));
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(
      screen.getByText('Primești o notificare când apare un task pentru tine.'),
    );
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    // A click on the switch itself toggles exactly once.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    const row = container.querySelector('[data-slot="switch-row"]');
    expect(row?.tagName).toBe('LABEL');
    expect(row?.className).toContain('min-h-11');
    expect((await axe.run(container, axeOptions)).violations).toEqual([]);
  });

  it('toggles from the keyboard and shows a solid focus ring', async () => {
    const user = userEvent.setup();
    render(<SwitchRow label="Rezumat pe email" />);
    const toggle = screen.getByRole('switch', { name: 'Rezumat pe email' });

    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Tailwind 4's `outline-none` sets the style to none, so a focus outline
    // is only drawn with `outline-solid` (#841/#842, X1).
    expect(toggle.className).toContain('focus-visible:outline-solid');
    expect(toggle.className).toContain('focus-visible:outline-3');
  });

  it('draws the off track with a 3:1 border token and a 44 px hit area', () => {
    render(<Switch aria-label="Notificări" />);
    const toggle = screen.getByRole('switch', { name: 'Notificări' });
    expect(toggle.className).toContain('border-ink-400');
    expect(toggle.className).not.toContain('border-transparent');
    expect(toggle.className).toContain('data-checked:bg-primary');
    // 24 px track + 10 px above and below = 44 px.
    expect(toggle.className).toContain('before:-inset-y-2.5');
  });
});

describe('RadioGroupItem and Checkbox (#842)', () => {
  it('moves a radio choice with the arrow keys inside 44 px rows', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <RadioGroup aria-label="Cine îl vede" defaultValue="grup">
        <ChoiceRow>
          <RadioGroupItem value="grup" />
          Doar grupul
        </ChoiceRow>
        <ChoiceRow>
          <RadioGroupItem value="toti" />
          Toți membrii
        </ChoiceRow>
      </RadioGroup>,
    );
    const group = screen.getByRole('radio', { name: 'Doar grupul' });
    const everyone = screen.getByRole('radio', { name: 'Toți membrii' });
    expect(group).toHaveAttribute('aria-checked', 'true');

    await user.tab();
    expect(group).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(everyone).toHaveFocus();
    expect(everyone).toHaveAttribute('aria-checked', 'true');
    expect(group).toHaveAttribute('aria-checked', 'false');

    expect(everyone.className).toContain('focus-visible:outline-solid');
    expect(everyone.className).toContain('size-5');
    expect(everyone.className).toContain('border-ink-400');
    for (const row of container.querySelectorAll('[data-slot="choice-row"]')) {
      expect(row.className).toContain('min-h-11');
    }
    expect((await axe.run(container, axeOptions)).violations).toEqual([]);
  });

  it('toggles a checkbox with Space and with a click on its row text', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ChoiceRow>
        <Checkbox />
        Fixează anunțul
      </ChoiceRow>,
    );
    const box = screen.getByRole('checkbox', { name: 'Fixează anunțul' });
    expect(box).toHaveAttribute('aria-checked', 'false');

    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(' ');
    expect(box).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByText('Fixează anunțul'));
    expect(box).toHaveAttribute('aria-checked', 'false');

    expect(box.className).toContain('focus-visible:outline-solid');
    expect(box.className).toContain('size-5');
    expect((await axe.run(container, axeOptions)).violations).toEqual([]);
  });
});

describe('NativeSelect (#842)', () => {
  it('draws the same field as the Combobox trigger', () => {
    render(
      <>
        <label>
          Campanie
          <NativeSelect defaultValue="">
            <NativeSelectOption value="">Fără campanie</NativeSelectOption>
            <NativeSelectOption value="1">Bal</NativeSelectOption>
          </NativeSelect>
        </label>
        <Combobox items={[]}>
          <ComboboxTrigger aria-label="Grup">Alege grupul</ComboboxTrigger>
        </Combobox>
      </>,
    );
    const select = screen.getByRole('combobox', { name: 'Campanie' });
    const trigger = screen.getByRole('combobox', { name: 'Grup' });

    for (const shared of [
      'h-11',
      'rounded-lg',
      'border-border',
      'bg-background',
    ]) {
      expect(select.className).toContain(shared);
      expect(trigger.className).toContain(shared);
    }
    expect(select.className).toContain('appearance-none');
    expect(select.className).toContain('focus-visible:outline-solid');

    // The same chevron, on the right, in both.
    const icon = select.parentElement?.querySelector(
      '[data-slot="native-select-icon"]',
    );
    expect(icon?.getAttribute('class')).toContain('lucide-chevrons-up-down');
    expect(icon?.getAttribute('class')).toContain('right-4');
    expect(trigger.querySelector('svg')?.getAttribute('class')).toContain(
      'lucide-chevrons-up-down',
    );
  });

  it('changes value like a native select', async () => {
    const user = userEvent.setup();
    function Picker() {
      const [value, setValue] = useState('recent');
      return (
        <>
          <NativeSelect
            aria-label="Ordonează"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            <NativeSelectOption value="recent">Cele mai noi</NativeSelectOption>
            <NativeSelectOption value="termen">După termen</NativeSelectOption>
          </NativeSelect>
          <output>{value}</output>
        </>
      );
    }
    render(<Picker />);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Ordonează' }),
      'termen',
    );
    expect(screen.getByRole('status')).toHaveTextContent('termen');
  });
});

describe('Sheet header and footer (#842)', () => {
  it('uses the dialog title, an X named "Închide" and the dialog footer', async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Editează profilul</SheetTrigger>
        <SheetPortal>
          <SheetBackdrop />
          <SheetPopup side="right" className="max-w-md p-4">
            <SheetHeader>
              <SheetTitle>Editează profilul</SheetTitle>
              <SheetDescription>Numele apare în tot OSUBB.</SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <button type="button">Renunță</button>
              <button type="submit">Salvează</button>
            </SheetFooter>
          </SheetPopup>
        </SheetPortal>
      </Sheet>,
    );
    const trigger = screen.getByRole('button', { name: 'Editează profilul' });
    await user.click(trigger);
    const sheet = await screen.findByRole('dialog', {
      name: 'Editează profilul',
    });
    expect(sheet).toHaveAccessibleDescription('Numele apare în tot OSUBB.');
    expect(sheet.className).toContain('right-0');
    expect(sheet.className).toContain('data-starting-style:translate-x-full');

    const title = document.querySelector('[data-slot="sheet-title"]');
    expect(title?.className).toContain('text-(length:--fs-lg)');
    expect(title?.className).toContain('font-bold');

    const footer = document.querySelector('[data-slot="sheet-footer"]');
    expect(footer?.className).toContain('flex-col-reverse');
    expect(footer?.className).toContain('sm:justify-end');
    expect(footer?.lastElementChild).toHaveTextContent('Salvează');

    const close = screen.getByRole('button', { name: 'Închide' });
    expect(close.textContent).toBe('');
    expect(close.className).toContain('size-11');
    await user.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('keeps the left drawer as the default side', async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Meniu</SheetTrigger>
        <SheetPortal>
          <SheetPopup>
            <SheetTitle>Meniu</SheetTitle>
          </SheetPopup>
        </SheetPortal>
      </Sheet>,
    );
    await user.click(screen.getByRole('button', { name: 'Meniu' }));
    const drawer = await screen.findByRole('dialog', { name: 'Meniu' });
    expect(drawer.className).toContain('left-0');
    expect(drawer.className).toContain('data-starting-style:-translate-x-full');
  });
});
