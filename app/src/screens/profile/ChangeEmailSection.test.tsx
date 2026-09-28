import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reasonCopy } from '../../lib/command-reasons';
import type { MyProfile } from '../../queries/profile';
import ChangeEmailSection from './ChangeEmailSection';

const updateUser = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { updateUser } },
}));

const authMock = vi.hoisted(() => ({
  session: { user: { id: 'p1' } } as {
    user: { id: string; new_email?: string };
  },
}));
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: authMock.session,
    claims: null,
    loading: false,
    signOut: vi.fn(),
  }),
}));

/** The Romanian copy of a reason; a missing one fails the test. */
function copy(reason: string): string {
  const text = reasonCopy(reason);
  if (text === undefined) throw new Error(`no copy for ${reason}`);
  return text;
}

const profile: MyProfile = {
  id: 'p1',
  full_name: 'Maria Enache',
  nickname: null,
  role: 'voluntar',
  status: 'activ',
  avatar_color: '#ED2025',
  joined_year: 2025,
  joined_at: '2025-10-01',
  email: 'maria@osubb.ro',
  phone: '0722334455',
};

function submit(value: string) {
  fireEvent.change(screen.getByLabelText('Adresa nouă'), {
    target: { value },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Schimbă adresa' }));
}

describe('ChangeEmailSection (#632)', () => {
  beforeEach(() => {
    updateUser.mockReset();
    authMock.session = { user: { id: 'p1' } };
  });

  it('shows the address the Member signs in with', () => {
    render(<ChangeEmailSection profile={profile} />);
    expect(screen.getByText('maria@osubb.ro')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Schimbă adresa de email' }),
    ).toBeInTheDocument();
  });

  it('asks Auth for the trimmed, lowercased address and brings the links back to Profil', async () => {
    updateUser.mockResolvedValue({ data: {}, error: null });
    render(<ChangeEmailSection profile={profile} />);

    submit('  ANA@Gmail.COM  ');

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    const [attributes, options] = updateUser.mock.calls[0] as [
      { email: string },
      { emailRedirectTo: string },
    ];
    expect(attributes).toEqual({ email: 'ana@gmail.com' });
    const redirect = new URL(options.emailRedirectTo);
    expect(redirect.pathname).toBe('/auth/callback');
    expect(redirect.searchParams.get('next')).toBe('/profil');
  });

  it('shows the double-confirmation pending state once Auth accepts', async () => {
    updateUser.mockResolvedValue({ data: {}, error: null });
    render(<ChangeEmailSection profile={profile} />);

    submit('ana@gmail.com');

    const pending = await screen.findByTestId('email-change-pending');
    expect(pending).toHaveTextContent('Confirmare trimisă');
    expect(pending).toHaveTextContent(
      /pe adresa actuală și pe ana@gmail.com\. Adresa se schimbă doar după ce confirmi de pe amândouă/,
    );
    expect(screen.getByLabelText('Adresa nouă')).toHaveValue('');
  });

  it('keeps showing a change Auth is still waiting on after a reload', () => {
    authMock.session = { user: { id: 'p1', new_email: 'ana@gmail.com' } };
    render(<ChangeEmailSection profile={profile} />);
    expect(screen.getByTestId('email-change-pending')).toHaveTextContent(
      'ana@gmail.com',
    );
  });

  it('drops the pending state once the profile carries the new address', () => {
    authMock.session = { user: { id: 'p1', new_email: 'ana@gmail.com' } };
    render(
      <ChangeEmailSection profile={{ ...profile, email: 'ana@gmail.com' }} />,
    );
    expect(
      screen.queryByTestId('email-change-pending'),
    ).not.toBeInTheDocument();
  });

  it('shows an address already used by another account in Romanian, under the field', async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: {
        code: 'email_exists',
        status: 422,
        message: 'A user with this email address has already been registered',
      },
    });
    render(<ChangeEmailSection profile={profile} />);

    submit('activ@osubb.ro');

    const input = screen.getByLabelText('Adresa nouă');
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText(copy('email_taken'))).toBeInTheDocument();
    expect(
      screen.queryByTestId('email-change-pending'),
    ).not.toBeInTheDocument();
  });

  it('shows a rate limit as a form-level message', async () => {
    updateUser.mockResolvedValue({
      data: { user: null },
      error: {
        code: 'over_email_send_rate_limit',
        status: 429,
        message: 'Email rate limit exceeded',
      },
    });
    render(<ChangeEmailSection profile={profile} />);

    submit('ana@gmail.com');

    expect(
      await screen.findByText(
        'Prea multe cereri într-un timp scurt. Încearcă din nou peste un minut.',
      ),
    ).toBeInTheDocument();
  });

  it('refuses the current address, compared normalised, without calling Auth', () => {
    render(
      <ChangeEmailSection profile={{ ...profile, email: 'Maria@OSUBB.ro' }} />,
    );

    submit(' maria@osubb.ro ');

    expect(updateUser).not.toHaveBeenCalled();
    expect(screen.getByText(copy('email_unchanged'))).toBeInTheDocument();
  });

  it.each(['', 'ana@'])(
    'refuses %j with the shared email rule, without calling Auth',
    (value) => {
      render(<ChangeEmailSection profile={profile} />);

      submit(value);

      expect(updateUser).not.toHaveBeenCalled();
      expect(screen.getByText(copy('email_invalid'))).toBeInTheDocument();
    },
  );
});
