import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axe from 'axe-core';
import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: api.invoke } },
}));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'bc-1' } } }),
}));
import { ReinvitePanel } from './ReinvitePanel';

const MEMBER = '11111111-2222-4333-8444-555555555555';

function status(patch: object = {}) {
  return {
    data: {
      member_id: MEMBER,
      email: 'gresit@osubb.local',
      last_sign_in_at: null,
      email_confirmed: false,
      ...patch,
    },
    error: null,
  };
}

/** A refusal as supabase-js hands it over: the function's Response inside. */
function refusal(code: string, httpStatus = 409) {
  const context = new Response(JSON.stringify({ error: 'text', code }), {
    status: httpStatus,
    headers: { 'Content-Type': 'application/json' },
  });
  return {
    data: null,
    error: Object.assign(new Error('Edge Function returned a non-2xx'), {
      context,
    }),
  };
}

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReinvitePanel memberId={MEMBER} />
    </QueryClientProvider>,
  );
}

beforeEach(() => api.invoke.mockReset());

it('asks the function whether the Member ever signed in', async () => {
  api.invoke.mockResolvedValue(status());
  show();
  expect(
    await screen.findByRole('button', { name: 'Retrimite invitația' }),
  ).toBeVisible();
  expect(api.invoke).toHaveBeenCalledWith('reinvite-member', {
    body: { member_id: MEMBER, action: 'status' },
  });
  expect(screen.getByLabelText('Adresa de email')).toHaveValue(
    'gresit@osubb.local',
  );
});

it.each([
  ['has signed in', { last_sign_in_at: '2026-09-20T10:00:00Z' }],
  ['has a confirmed address', { email_confirmed: true }],
])('is hidden when the Member %s', async (_, patch) => {
  api.invoke.mockResolvedValue(status(patch));
  const { container } = show();
  await waitFor(() => expect(api.invoke).toHaveBeenCalledTimes(1));
  // Let the query settle, then prove nothing rendered.
  await waitFor(() => expect(container).toBeEmptyDOMElement());
  expect(screen.queryByRole('button', { name: 'Retrimite invitația' })).toBe(
    null,
  );
});

it('is hidden when the status read is refused', async () => {
  api.invoke.mockResolvedValue(refusal('member_manage_forbidden', 403));
  const { container } = show();
  await waitFor(() => expect(api.invoke).toHaveBeenCalledTimes(1));
  expect(container).toBeEmptyDOMElement();
});

it('sends the corrected, normalised address and confirms it', async () => {
  const user = userEvent.setup();
  api.invoke.mockResolvedValueOnce(status()).mockResolvedValueOnce({
    data: {
      member_id: MEMBER,
      email: 'corect@osubb.local',
      email_changed: true,
    },
    error: null,
  });
  api.invoke.mockResolvedValue(status({ email: 'corect@osubb.local' }));
  const { container } = show();
  const field = await screen.findByLabelText('Adresa de email');
  await user.clear(field);
  await user.type(field, '  Corect@OSUBB.local ');
  await user.click(screen.getByRole('button', { name: 'Retrimite invitația' }));

  expect(api.invoke).toHaveBeenNthCalledWith(2, 'reinvite-member', {
    body: { member_id: MEMBER, email: 'corect@osubb.local' },
  });
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Invitația a fost retrimisă la corect@osubb.local.',
  );
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('refuses a malformed address in the browser without calling the function', async () => {
  const user = userEvent.setup();
  api.invoke.mockResolvedValue(status());
  show();
  const field = await screen.findByLabelText('Adresa de email');
  await user.clear(field);
  await user.type(field, 'fara-arond');
  await user.click(screen.getByRole('button', { name: 'Retrimite invitația' }));
  expect(
    await screen.findByText('Scrie o adresă de email validă.'),
  ).toBeVisible();
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

it('shows a taken address under the field', async () => {
  const user = userEvent.setup();
  api.invoke
    .mockResolvedValueOnce(status())
    .mockResolvedValueOnce(refusal('email_taken'));
  show();
  const field = await screen.findByLabelText('Adresa de email');
  await user.clear(field);
  await user.type(field, 'altcineva@osubb.local');
  await user.click(screen.getByRole('button', { name: 'Retrimite invitația' }));
  expect(
    await screen.findByText(
      'Adresa este folosită deja de alt cont. Verifică adresa.',
    ),
  ).toBeVisible();
  expect(field).toHaveAttribute('aria-invalid', 'true');
});

it('shows the Romanian copy when the Member signed in meanwhile', async () => {
  const user = userEvent.setup();
  api.invoke
    .mockResolvedValueOnce(status())
    .mockResolvedValueOnce(refusal('already_active'));
  show();
  await user.click(
    await screen.findByRole('button', { name: 'Retrimite invitația' }),
  );
  expect(
    await screen.findByText(
      'Membrul s-a autentificat deja, deci invitația nu se mai retrimite.',
    ),
  ).toBeVisible();
});

it('falls back to a generic message when the gateway answers without a body', async () => {
  const user = userEvent.setup();
  api.invoke.mockResolvedValueOnce(status()).mockResolvedValueOnce({
    data: null,
    error: new Error('Failed to send a request to the Edge Function'),
  });
  show();
  await user.click(
    await screen.findByRole('button', { name: 'Retrimite invitația' }),
  );
  expect(
    await screen.findByText(
      'Nu am putut retrimite invitația. Verifică internetul și încearcă din nou.',
    ),
  ).toBeVisible();
});
