import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';
import { db, resetDb, show } from '../../../test/portofoliu-fake';
import { findFormattedText } from '../../../test/formatted-text';

vi.mock('../../../lib/supabase', async () =>
  (await import('../../../test/portofoliu-fake')).supabaseMock(),
);
vi.mock('../../../lib/auth', async () =>
  (await import('../../../test/portofoliu-fake')).authMock(),
);
import { MessagePanel } from './MessagePanel';

vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  resetDb();
});

const A_MESSAGE = {
  title: 'Mesaj de la Biroul de Conducere',
  body: 'Felicitări, ai devenit **Voluntar Activ**!',
  link_url: 'https://forms.example.org/aderare',
  link_label: 'Deschide formularul de adeziune',
  version: 1,
  updated_at: '2026-09-20T10:00:00Z',
  updated_by: 'bc',
};

const sent = () =>
  db.rpc.mock.calls
    .filter(([name]) => name === 'set_adherence_message')
    .map(([, args]) => args);

const panel = () =>
  screen.findByRole('region', { name: 'Mesajul pentru Voluntarii Activi' });

it('starts a first message from the day-one row: the heading and the moved link filled in, one Publică', async () => {
  const { container } = show(<MessagePanel />);
  const region = await panel();
  expect(region).toHaveTextContent(
    'Îl văd, ca fereastră care trebuie confirmată, Voluntarii Activi studenți UBB.',
  );
  expect(within(region).getByLabelText('Titlu')).toHaveValue(
    'Mesaj de la Biroul de Conducere',
  );
  expect(await findFormattedText('Mesaj', region)).toHaveTextContent('');
  expect(within(region).getByLabelText('Link (opțional)')).toHaveValue(
    'https://forms.example.org/aderare',
  );
  expect(within(region).getByLabelText('Textul butonului')).toHaveValue(
    'Deschide formularul de adeziune',
  );
  // No message yet: no counts, nothing to save quietly or turn off.
  expect(container.querySelector('[data-slot="message-counts"]')).toBeNull();
  expect(
    within(region)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(expect.arrayContaining(['Publică', 'Previzualizează']));
  expect(within(region).queryByRole('button', { name: 'Salvează' })).toBeNull();
  expect(
    within(region).queryByRole('button', { name: 'Oprește mesajul' }),
  ).toBeNull();
  expect((await axe.run(container)).violations).toEqual([]);
});

it('publishes only with a message, after saying who will see it', async () => {
  const user = userEvent.setup();
  show(<MessagePanel />);
  const region = await panel();
  const body = await findFormattedText('Mesaj', region);

  // No body: refused in the browser, under the field, and nothing is sent.
  await user.click(within(region).getByRole('button', { name: 'Publică' }));
  expect(await within(region).findByText('Scrie mesajul.')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(sent()).toEqual([]);

  await user.click(body);
  await user.keyboard('Felicitări, ai devenit Voluntar Activ!');
  await user.click(within(region).getByRole('button', { name: 'Publică' }));
  const confirm = await screen.findByRole('dialog', {
    name: 'Publici mesajul?',
  });
  expect(confirm).toHaveTextContent(
    'Toți cei 30 de Voluntari Activi studenți UBB vor vedea mesajul și vor trebui să-l confirme.',
  );
  // Renunță sends nothing.
  await user.click(within(confirm).getByRole('button', { name: 'Renunță' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(sent()).toEqual([]);

  await user.click(within(region).getByRole('button', { name: 'Publică' }));
  await user.click(
    within(
      await screen.findByRole('dialog', { name: 'Publici mesajul?' }),
    ).getByRole('button', { name: 'Publică' }),
  );
  await waitFor(() =>
    expect(sent()).toEqual([
      {
        p_title: 'Mesaj de la Biroul de Conducere',
        p_body: 'Felicitări, ai devenit Voluntar Activ!',
        p_link_url: 'https://forms.example.org/aderare',
        p_link_label: 'Deschide formularul de adeziune',
        p_ask_again: false,
      },
    ]),
  );
  expect(await within(region).findByRole('status')).toHaveTextContent(
    'Mesaj publicat.',
  );
  // Now a message exists: the two saves, the off switch and the counts.
  expect(
    await within(region).findByRole('button', { name: 'Salvează' }),
  ).toBeDisabled();
  expect(
    within(region).getByRole('button', { name: 'Salvează și arată din nou' }),
  ).toBeEnabled();
  expect(
    within(region).getByRole('button', { name: 'Oprește mesajul' }),
  ).toBeEnabled();
  expect(
    await within(region).findByText(
      'Confirmat de 0 din 30 de Voluntari Activi studenți UBB.',
    ),
  ).toBeVisible();
  // The typed text stays in the form after the save.
  expect(body).toHaveTextContent('Felicitări, ai devenit Voluntar Activ!');
});

it('saves a correction quietly, and asks again only after confirming', async () => {
  const user = userEvent.setup();
  db.message = { ...A_MESSAGE };
  db.messageStatus = { eligible_count: 30, answered_count: 12 };
  show(<MessagePanel />);
  const region = await panel();
  expect(
    await within(region).findByText(
      'Confirmat de 12 din 30 de Voluntari Activi studenți UBB.',
    ),
  ).toBeVisible();
  const save = within(region).getByRole('button', { name: 'Salvează' });
  expect(save).toBeDisabled();

  const title = within(region).getByLabelText('Titlu');
  await user.clear(title);
  await user.type(title, 'Mesaj de la BC');
  expect(save).toBeEnabled();
  await user.click(save);
  // A correction asks nobody: no confirmation, `p_ask_again` false.
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() =>
    expect(sent()).toEqual([
      expect.objectContaining({
        p_title: 'Mesaj de la BC',
        p_ask_again: false,
      }),
    ]),
  );
  expect(await within(region).findByRole('status')).toHaveTextContent(
    'Mesaj salvat. Cine l-a citit nu îl mai vede ca fereastră.',
  );
  expect(db.message.version).toBe(1);

  await user.click(
    within(region).getByRole('button', { name: 'Salvează și arată din nou' }),
  );
  const confirm = await screen.findByRole('dialog', {
    name: 'Arăți mesajul din nou?',
  });
  expect(confirm).toHaveTextContent(
    'Toți cei 30 de Voluntari Activi studenți UBB vor vedea din nou mesajul și vor trebui să-l confirme.',
  );
  await user.click(
    within(confirm).getByRole('button', { name: 'Salvează și arată din nou' }),
  );
  await waitFor(() =>
    expect(sent().at(-1)).toEqual(
      expect.objectContaining({ p_title: 'Mesaj de la BC', p_ask_again: true }),
    ),
  );
  expect(await within(region).findByRole('status')).toHaveTextContent(
    'Mesaj salvat. Toți îl vor vedea din nou.',
  );
  expect(db.message.version).toBe(2);
});

it('turns the message off after confirming, keeping the stored link', async () => {
  const user = userEvent.setup();
  db.message = { ...A_MESSAGE };
  show(<MessagePanel />);
  const region = await panel();
  await user.click(
    await within(region).findByRole('button', { name: 'Oprește mesajul' }),
  );
  const confirm = await screen.findByRole('dialog', {
    name: 'Oprești mesajul?',
  });
  expect(confirm).toHaveTextContent(
    'Nimeni nu va mai vedea mesajul, nici în Profil. Linkul rămâne salvat.',
  );
  await user.click(
    within(confirm).getByRole('button', { name: 'Oprește mesajul' }),
  );
  await waitFor(() =>
    expect(sent()).toEqual([
      {
        p_title: '',
        p_body: '',
        p_link_url: 'https://forms.example.org/aderare',
        p_link_label: 'Deschide formularul de adeziune',
        p_ask_again: false,
      },
    ]),
  );
  expect(await within(region).findByRole('status')).toHaveTextContent(
    'Mesajul a fost oprit.',
  );
  // Off: back to one Publică, the link still in the form.
  expect(
    await within(region).findByRole('button', { name: 'Publică' }),
  ).toBeVisible();
  expect(within(region).getByLabelText('Link (opțional)')).toHaveValue(
    'https://forms.example.org/aderare',
  );
});

it('fills in the button words for a typed link, and judges the link as an Attached Link', async () => {
  const user = userEvent.setup();
  db.message = { ...A_MESSAGE, link_url: null, link_label: null };
  show(<MessagePanel />);
  const region = await panel();
  const url = within(region).getByLabelText('Link (opțional)');
  const label = within(region).getByLabelText('Textul butonului');
  expect(url).toHaveValue('');
  expect(label).toHaveValue('');

  await user.type(url, 'ftp://forms.example.org');
  expect(label).toHaveValue('Deschide formularul de adeziune');
  await user.click(within(region).getByRole('button', { name: 'Salvează' }));
  expect(
    await within(region).findByText(
      'Adresa trebuie să înceapă cu http:// sau https://.',
    ),
  ).toBeVisible();
  expect(url).toHaveAttribute('aria-invalid', 'true');
  expect(sent()).toEqual([]);

  // Words the member wrote are never replaced.
  await user.clear(url);
  await user.clear(label);
  await user.type(label, 'Formularul');
  await user.type(url, 'https://forms.example.org/a');
  expect(label).toHaveValue('Formularul');
});

it('shows a refusal from the server in the form', async () => {
  const user = userEvent.setup();
  db.message = { ...A_MESSAGE };
  db.refuse.set('set_adherence_message', {
    code: '42501',
    message: 'adherence_message_manage_forbidden',
  });
  show(<MessagePanel />);
  const region = await panel();
  const title = within(region).getByLabelText('Titlu');
  await user.type(title, '!');
  await user.click(within(region).getByRole('button', { name: 'Salvează' }));
  expect(
    await within(region).findByText(
      'Doar BC și Moderatorul pot schimba mesajul pentru Voluntarii Activi.',
    ),
  ).toBeVisible();
  expect(within(region).getByRole('status')).toBeEmptyDOMElement();
});

it('previews the pop-up as a Member sees it, and closes it as any dialog', async () => {
  const user = userEvent.setup();
  db.message = { ...A_MESSAGE };
  show(<MessagePanel />);
  const region = await panel();
  await findFormattedText('Mesaj', region);
  await user.click(
    within(region).getByRole('button', { name: 'Previzualizează' }),
  );
  const preview = await screen.findByRole('dialog', {
    name: 'Mesaj de la Biroul de Conducere',
  });
  // Why the Member receives it: the Role chip and the Universitate.
  expect(
    within(preview).getByText('Voluntar Activ', { selector: '.role-badge' }),
  ).toBeVisible();
  expect(within(preview).getByText('Student UBB')).toBeVisible();
  // The body is Formatted Text, read as the reader reads it.
  expect(
    within(preview).getByText('Voluntar Activ', { selector: 'strong' }),
  ).toBeVisible();
  const link = within(preview).getByRole('link', {
    name: /Deschide formularul de adeziune/,
  });
  expect(link).toHaveAttribute('href', 'https://forms.example.org/aderare');
  expect(link).toHaveAttribute('target', '_blank');
  // A preview, not the pop-up: it has its X and Escape closes it.
  expect(
    within(preview).getByRole('button', { name: 'Închide' }),
  ).toBeVisible();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(sent()).toEqual([]);
});
