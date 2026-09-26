import * as axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { CommandError } from '../../lib/command-reasons';
import { SubmitForReviewDialog } from './SubmitForReviewDialog';

function renderDialog(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const onSuccess = vi.fn();
  render(
    <SubmitForReviewDialog
      pending={false}
      onSubmit={onSubmit}
      onSuccess={onSuccess}
    />,
  );
  return { onSubmit, onSuccess };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: 'Trimite la verificare' }),
  );
  return screen.findByRole('dialog', { name: 'Trimite la verificare' });
}

const send = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Trimite la verificare' });

it('submits an empty draft as nulls: no note, no link', async () => {
  const user = userEvent.setup();
  const { onSubmit, onSuccess } = renderDialog();
  const dialog = await open(user);
  await user.type(
    within(dialog).getByLabelText('Notă pentru verificator (opțional)'),
    '   ',
  );
  await user.click(send(dialog));
  expect(onSubmit).toHaveBeenCalledWith({
    note: null,
    linkLabel: null,
    linkUrl: null,
  });
  expect(onSuccess).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('sends the trimmed note and link', async () => {
  const user = userEvent.setup();
  const { onSubmit } = renderDialog();
  const dialog = await open(user);
  await user.type(
    within(dialog).getByLabelText('Notă pentru verificator (opțional)'),
    '  Am pus afișul în folder.  ',
  );
  await user.type(within(dialog).getByLabelText('Etichetă link'), ' Afiș ');
  await user.type(
    within(dialog).getByLabelText('Adresă link'),
    'https://drive.example/afis',
  );
  await user.click(send(dialog));
  expect(onSubmit).toHaveBeenCalledWith({
    note: 'Am pus afișul în folder.',
    linkLabel: 'Afiș',
    linkUrl: 'https://drive.example/afis',
  });
});

it('refuses a 1001-character note under its field before any request', async () => {
  const user = userEvent.setup();
  const { onSubmit } = renderDialog();
  const dialog = await open(user);
  const note = within(dialog).getByLabelText(
    'Notă pentru verificator (opțional)',
  );
  // Pasting is instant; typing 1001 characters one by one is not.
  await user.click(note);
  await user.paste('n'.repeat(1001));
  await user.click(send(dialog));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(note).toHaveAccessibleDescription(
    expect.stringContaining('Nota are cel mult 1000 de caractere.'),
  );
  expect(note).toHaveFocus();
});

it('refuses a half-set link under the missing field before any request', async () => {
  const user = userEvent.setup();
  const { onSubmit } = renderDialog();
  const dialog = await open(user);
  await user.type(within(dialog).getByLabelText('Etichetă link'), 'Afiș');
  await user.click(send(dialog));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(
    within(dialog).getByLabelText('Adresă link'),
  ).toHaveAccessibleDescription(
    expect.stringContaining('Scrie adresa linkului sau lasă linkul gol.'),
  );
});

it('puts a server reason under the field it belongs to and keeps the draft', async () => {
  const user = userEvent.setup();
  const onSubmit = vi
    .fn()
    .mockRejectedValue(
      new CommandError({ code: 'PT400', message: 'link_url_invalid' }, 'x'),
    );
  renderDialog(onSubmit);
  const dialog = await open(user);
  await user.type(within(dialog).getByLabelText('Etichetă link'), 'Afiș');
  await user.type(
    within(dialog).getByLabelText('Adresă link'),
    'https://drive.example/afis',
  );
  await user.click(send(dialog));
  const url = within(dialog).getByLabelText('Adresă link');
  expect(url).toHaveAccessibleDescription(
    expect.stringContaining(
      'Adresa trebuie să înceapă cu http:// sau https://.',
    ),
  );
  expect(url).toHaveValue('https://drive.example/afis');
  expect(screen.getByRole('dialog')).toBeVisible();
});

it('shows a refusal that belongs to no field in the form slot', async () => {
  const user = userEvent.setup();
  const onSubmit = vi
    .fn()
    .mockRejectedValue(new CommandError(null, 'Taskul s-a schimbat.'));
  renderDialog(onSubmit);
  const dialog = await open(user);
  await user.click(send(dialog));
  expect(within(dialog).getByText('Taskul s-a schimbat.')).toBeVisible();
});

it('passes automated accessibility checks', async () => {
  const user = userEvent.setup();
  renderDialog();
  const dialog = await open(user);
  await user.type(within(dialog).getByLabelText('Etichetă link'), 'Afiș');
  await user.click(send(dialog));
  const results = await axe.run(dialog, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});
