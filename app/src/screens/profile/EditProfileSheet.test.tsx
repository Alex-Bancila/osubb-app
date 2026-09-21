import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyProfile } from '../../queries/profile';
import EditProfileSheet from './EditProfileSheet';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const updateProfileMock = vi.fn();

vi.mock('../../queries/profile', () => ({
  useUpdateMyProfile: () => ({
    mutateAsync: updateProfileMock,
    isPending: false,
    error: null,
  }),
}));

const sampleProfile: MyProfile = {
  id: 'p1',
  full_name: 'Ana Popescu',
  role: 'voluntar',
  status: 'activ',
  tier: null,
  avatar_color: '#284C93',
  joined_year: 2025,
  joined_at: '2025-01-01',
  email: 'ana@osubb.ro',
  phone: '0711223344',
};

function wrapper(queryClient = new QueryClient()) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('EditProfileSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateProfileMock.mockResolvedValue(undefined);
  });

  it('renders existing profile fields with email disabled', () => {
    render(
      <EditProfileSheet
        open={true}
        onClose={vi.fn()}
        profile={sampleProfile}
      />,
      { wrapper: wrapper() },
    );

    const nameInput = screen.getByLabelText(/nume complet/i);
    expect(nameInput).toHaveValue('Ana Popescu');

    const phoneInput = screen.getByLabelText(/număr de telefon/i);
    expect(phoneInput).toHaveValue('0711223344');

    const emailInput = screen.getByLabelText(/adresă de email/i);
    expect(emailInput).toHaveValue('ana@osubb.ro');
    expect(emailInput).toBeDisabled();
    expect(
      screen.getByText(/adresa de email este identificatorul contului tău/i),
    ).toBeInTheDocument();
  });

  it('submits updated name, phone, and avatar color', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <EditProfileSheet
        open={true}
        onClose={onClose}
        profile={sampleProfile}
      />,
      { wrapper: wrapper() },
    );

    const nameInput = screen.getByLabelText(/nume complet/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Ana Ionescu');

    const phoneInput = screen.getByLabelText(/număr de telefon/i);
    await user.clear(phoneInput);
    await user.type(phoneInput, '0799001122');

    // Select OSUBB Red color swatch
    const redSwatch = screen.getByRole('button', { name: /roșu osubb/i });
    await user.click(redSwatch);

    const saveButton = screen.getByRole('button', {
      name: /salvează modificările/i,
    });
    await user.click(saveButton);

    expect(updateProfileMock).toHaveBeenCalledWith({
      fullName: 'Ana Ionescu',
      phone: '0799001122',
      avatarColor: '#ED2025',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('validates that full name cannot be blank', async () => {
    const user = userEvent.setup();

    render(
      <EditProfileSheet
        open={true}
        onClose={vi.fn()}
        profile={sampleProfile}
      />,
      { wrapper: wrapper() },
    );

    const nameInput = screen.getByLabelText(/nume complet/i);
    await user.clear(nameInput);

    const saveButton = screen.getByRole('button', {
      name: /salvează modificările/i,
    });
    await user.click(saveButton);

    expect(updateProfileMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/numele complet este obligatoriu/i),
    ).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <EditProfileSheet
        open={true}
        onClose={onClose}
        profile={sampleProfile}
      />,
      { wrapper: wrapper() },
    );

    const closeButton = screen.getByRole('button', { name: /închide/i });
    await user.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });
});
