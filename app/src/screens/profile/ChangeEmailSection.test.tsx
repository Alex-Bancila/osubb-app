import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { MyProfile } from '../../queries/profile';
import ChangeEmailSection from './ChangeEmailSection';

// -- Supabase mock --
const updateUserMock = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: (...args: unknown[]) => updateUserMock(...args),
    },
  },
}));

vi.mock('../../lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'p1' } },
    claims: null,
    loading: false,
    signOut: vi.fn(),
  }),
}));

const baseProfile: MyProfile = {
  id: 'p1',
  full_name: 'Maria Enache',
  role: 'voluntar',
  nickname: null,
  status: 'activ',
  avatar_color: '#ED2025',
  joined_year: 2025,
  joined_at: '2025-10-01',
  email: 'maria@osubb.ro',
  phone: '0722334455',
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('ChangeEmailSection', () => {
  beforeEach(() => {
    updateUserMock.mockReset();
  });

  it('shows the current email address', () => {
    render(<ChangeEmailSection profile={baseProfile} />, { wrapper });
    expect(screen.getByText('maria@osubb.ro')).toBeInTheDocument();
  });

  it('calls auth.updateUser with the normalized (trimmed, lowercased) email', async () => {
    updateUserMock.mockResolvedValue({ data: {}, error: null });

    render(<ChangeEmailSection profile={baseProfile} />, { wrapper });

    const input = screen.getByLabelText('Nouă adresă');
    fireEvent.change(input, { target: { value: '  ANA@Gmail.COM  ' } });

    const button = screen.getByRole('button', {
      name: 'Schimbă adresa de email',
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({
        email: 'ana@gmail.com',
      });
    });
  });

  it('renders the pending (double-confirmation) copy on success', async () => {
    updateUserMock.mockResolvedValue({ data: {}, error: null });

    render(<ChangeEmailSection profile={baseProfile} />, { wrapper });

    fireEvent.change(screen.getByLabelText('Nouă adresă'), {
      target: { value: 'ana@gmail.com' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Schimbă adresa de email' }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('email-change-pending')).toBeInTheDocument();
    });

    expect(screen.getByText('Confirmare trimisă')).toBeInTheDocument();
    expect(
      screen.getByText(/Am trimis un email de confirmare/),
    ).toBeInTheDocument();
  });

  it('maps "already in use" Auth error to Romanian', async () => {
    updateUserMock.mockResolvedValue({
      data: null,
      error: { code: 'email_exists', message: 'User already registered', status: 422 },
    });

    render(<ChangeEmailSection profile={baseProfile} />, { wrapper });

    fireEvent.change(screen.getByLabelText('Nouă adresă'), {
      target: { value: 'taken@gmail.com' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Schimbă adresa de email' }),
    );

    await waitFor(() => {
      const errors = screen.getAllByText('Această adresă de email este deja folosită de un alt cont.');
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  it('shows a client-side error when the address is the same as current', async () => {
    render(<ChangeEmailSection profile={baseProfile} />, { wrapper });

    fireEvent.change(screen.getByLabelText('Nouă adresă'), {
      target: { value: 'maria@osubb.ro' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Schimbă adresa de email' }),
    );

    // Client-side validation — no Auth call
    expect(updateUserMock).not.toHaveBeenCalled();
    const errors = screen.getAllByText('Noua adresă este identică cu cea actuală.');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('shows a client-side error when the input is empty', async () => {
    render(<ChangeEmailSection profile={baseProfile} />, { wrapper });

    fireEvent.click(
      screen.getByRole('button', { name: 'Schimbă adresa de email' }),
    );

    expect(updateUserMock).not.toHaveBeenCalled();
  });
});
