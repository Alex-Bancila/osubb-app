import * as axe from 'axe-core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import {
  attachedLinksSchema,
  linksFieldForReason,
} from '../../lib/schemas/attached-link';
import { useFormValidation } from '../../lib/use-form-validation';
import type { AttachedLinkValue } from './AttachedLinkFields';
import { AttachedLinksFields } from './AttachedLinksFields';

const schema = z.object({ links: attachedLinksSchema });

/**
 * A minimal caller: `useFormValidation` over `{ links }`, the shape every
 * form that carries Attached Links gives it (R46), and the parsed value
 * handed to `onSaved` the way a form hands it to its command.
 */
function Harness({
  initial = [],
  onSaved = () => {},
}: {
  initial?: AttachedLinkValue[];
  onSaved?: (links: z.output<typeof schema>['links']) => void;
}) {
  const [links, setLinks] = useState<AttachedLinkValue[]>(initial);
  const form = useFormValidation(
    schema,
    { links },
    linksFieldForReason('links'),
  );
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = form.validate();
        if (parsed) onSaved(parsed.links);
      }}
    >
      <AttachedLinksFields value={links} onChange={setLinks} form={form} />
      <button
        type="button"
        onClick={() => form.fail({ message: 'too_many_links' }, 'fallback')}
      >
        Simulează refuz server
      </button>
      <button type="submit">Salvează</button>
    </form>
  );
}

const save = () => screen.getByRole('button', { name: 'Salvează' });
const add = () => screen.getByRole('button', { name: 'Adaugă link' });
const label = (n: number) => screen.getByLabelText(`Etichetă link ${n}`);
const address = (n: number) => screen.getByLabelText(`Adresă link ${n}`);
const full = (n: number): AttachedLinkValue[] =>
  Array.from({ length: n }, (_, index) => ({
    label: `Link ${index + 1}`,
    url: `https://osubb.ro/${index + 1}`,
  }));

describe('AttachedLinksFields', () => {
  it('starts with no rows and adds one at a time, the cursor in its label', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByLabelText(/Etichetă link/)).toBeNull();
    await user.click(add());
    expect(label(1)).toHaveFocus();
    await user.click(add());
    expect(label(2)).toHaveFocus();
    expect(screen.getByText('2 din 5')).toBeInTheDocument();
  });

  it('stops at five: no "Adaugă link" once the fifth row is there', async () => {
    const user = userEvent.setup();
    render(<Harness initial={full(4)} />);
    await user.click(add());
    expect(label(5)).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Adaugă link' })).toBeNull();
    expect(
      screen.getByText('Ai atașat numărul maxim de linkuri (5).'),
    ).toBeInTheDocument();
    // Removing one brings the button back; the cursor goes to the row
    // above the removed last one.
    await user.click(screen.getByRole('button', { name: 'Elimină linkul 5' }));
    expect(add()).toBeInTheDocument();
    expect(label(4)).toHaveFocus();
  });

  it('moves the cursor to “Adaugă link” when the only row goes', async () => {
    const user = userEvent.setup();
    render(<Harness initial={full(1)} />);
    await user.click(screen.getByRole('button', { name: 'Elimină linkul 1' }));
    expect(add()).toHaveFocus();
  });

  it('removes a row and moves the cursor to the row that took its place', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<Harness initial={full(3)} onSaved={onSaved} />);
    await user.click(screen.getByRole('button', { name: 'Elimină linkul 2' }));
    expect(label(2)).toHaveFocus();
    expect(label(2)).toHaveValue('Link 3');
    await user.click(save());
    expect(onSaved).toHaveBeenCalledWith([
      { label: 'Link 1', url: 'https://osubb.ro/1' },
      { label: 'Link 3', url: 'https://osubb.ro/3' },
    ]);
  });

  it('works from the keyboard alone', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<Harness onSaved={onSaved} />);
    add().focus();
    await user.keyboard('{Enter}');
    await user.keyboard('Program');
    await user.tab();
    expect(address(1)).toHaveFocus();
    await user.keyboard('https://osubb.ro/program');
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'Elimină linkul 1' }),
    ).toHaveFocus();
    await user.click(save());
    expect(onSaved).toHaveBeenCalledWith([
      { label: 'Program', url: 'https://osubb.ro/program' },
    ]);
  });

  it('shows each row’s errors under that row’s own fields', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <Harness
        initial={[
          { label: 'Program', url: 'https://osubb.ro/p' },
          { label: 'Formular', url: '' },
          { label: '', url: 'ftp://osubb.ro' },
        ]}
        onSaved={onSaved}
      />,
    );
    await user.click(save());
    expect(onSaved).not.toHaveBeenCalled();
    expect(address(1)).not.toHaveAttribute('aria-invalid');
    expect(address(2)).toHaveAccessibleDescription(
      /Scrie adresa linkului sau lasă linkul gol\./,
    );
    expect(label(3)).toHaveAccessibleDescription(
      'Scrie numele linkului sau lasă linkul gol.',
    );
    expect(address(3)).toHaveAccessibleDescription(
      /Adresa trebuie să înceapă cu http:\/\/ sau https:\/\/\./,
    );
    // The first broken field takes the cursor.
    expect(address(2)).toHaveFocus();
  });

  it('drops a blank row on save', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<Harness initial={full(1)} onSaved={onSaved} />);
    await user.click(add());
    await user.click(save());
    expect(onSaved).toHaveBeenCalledWith(full(1));
  });

  it('puts a server refusal that names no row on the list', async () => {
    const user = userEvent.setup();
    render(<Harness initial={full(2)} />);
    await user.click(
      screen.getByRole('button', { name: 'Simulează refuz server' }),
    );
    expect(
      screen.getByText('Poți atașa cel mult 5 linkuri.'),
    ).toBeInTheDocument();
  });

  it('names every row and control for assistive technology', async () => {
    const { container } = render(<Harness initial={full(2)} />);
    const group = screen.getByRole('group', { name: 'Link 2' });
    expect(within(group).getByLabelText('Etichetă link 2')).toHaveValue(
      'Link 2',
    );
    expect(address(1)).toHaveAccessibleDescription(
      'Adresa începe cu http:// sau https://',
    );
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
