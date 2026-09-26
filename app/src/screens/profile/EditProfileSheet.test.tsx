import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyProfile } from '../../queries/profile';
import EditProfileSheet from './EditProfileSheet';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const updateProfileMock = vi.fn();
// `manageRoles` is the BC/Moderator rank: the only one allowed to change a
// full name (#675, R5). Each test sets it; the default is an ordinary Member.
const capabilityMock = vi.hoisted(() => ({ manageRoles: false }));

vi.mock('../../lib/capabilities', () => ({
  useCapability: (name: 'manageRoles') => ({ data: capabilityMock[name] }),
}));

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
    capabilityMock.manageRoles = false;
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
    expect(
      screen.getByText(
        /numărul de telefon este vizibil doar pentru tine și membrii cu nivel ≥5/i,
      ),
    ).toBeInTheDocument();

    const emailInput = screen.getByLabelText(/adresă de email/i);
    expect(emailInput).toHaveValue('ana@osubb.ro');
    expect(emailInput).toBeDisabled();
    expect(
      screen.getByText(/adresa de email este identificatorul contului tău/i),
    ).toBeInTheDocument();
  });

  it('shows the full name read-only below BC and saves without sending it (#675)', async () => {
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
    expect(nameInput).toHaveValue('Ana Popescu');
    expect(nameInput).toBeDisabled();
    expect(
      screen.getByText(/numele complet îl modifică biroul de conducere/i),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /salvează modificările/i }),
    );

    // The phone is sent in E.164 (ruling R8), as the server stores it.
    expect(updateProfileMock).toHaveBeenCalledWith({
      phone: '+40711223344',
      avatarColor: '#284C93',
    });
    expect(updateProfileMock.mock.calls[0]?.[0]).not.toHaveProperty('fullName');
    expect(onClose).toHaveBeenCalled();
  });

  it('lets BC submit an updated name, phone, and avatar color', async () => {
    capabilityMock.manageRoles = true;
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
      phone: '+40799001122',
      avatarColor: '#ED2025',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('validates that full name cannot be blank', async () => {
    capabilityMock.manageRoles = true;
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
    expect(nameInput).toHaveAccessibleDescription('Scrie numele complet.');
    expect(nameInput).toHaveFocus();
  });

  it('submits null phone when phone input is cleared', async () => {
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

    const phoneInput = screen.getByLabelText(/număr de telefon/i);
    await user.clear(phoneInput);

    const saveButton = screen.getByRole('button', {
      name: /salvează modificările/i,
    });
    await user.click(saveButton);

    expect(updateProfileMock).toHaveBeenCalledWith({
      phone: null,
      avatarColor: '#284C93',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('checks the phone before sending it and puts the server phone_invalid under it', async () => {
    const user = userEvent.setup();
    updateProfileMock.mockRejectedValueOnce({
      code: '23514',
      message: 'phone_invalid',
    });

    render(
      <EditProfileSheet
        open={true}
        onClose={vi.fn()}
        profile={sampleProfile}
      />,
      { wrapper: wrapper() },
    );

    const phoneInput = screen.getByLabelText(/număr de telefon/i);
    await user.clear(phoneInput);
    await user.type(phoneInput, '0630 655 145');
    await user.tab();
    expect(phoneInput).toHaveAccessibleDescription(
      /Scrie un număr de telefon valid \(de exemplu 0730 655 145\)\./,
    );

    await user.clear(phoneInput);
    await user.type(phoneInput, '+40 0730 655 145');
    const saveButton = screen.getByRole('button', {
      name: /salvează modificările/i,
    });
    await user.click(saveButton);
    expect(updateProfileMock).toHaveBeenCalledWith({
      phone: '+40730655145',
      avatarColor: '#284C93',
    });
    expect(phoneInput).toHaveAccessibleDescription(
      /Scrie un număr de telefon valid/,
    );
    expect(phoneInput).toHaveFocus();
  });

  it('renders an error alert when the profile update fails', async () => {
    const user = userEvent.setup();
    updateProfileMock.mockRejectedValueOnce({
      code: 'XX000',
      message: 'connection reset by peer',
    });

    render(
      <EditProfileSheet
        open={true}
        onClose={vi.fn()}
        profile={sampleProfile}
      />,
      { wrapper: wrapper() },
    );

    const saveButton = screen.getByRole('button', {
      name: /salvează modificările/i,
    });
    await user.click(saveButton);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nu am putut salva modificările.',
    );
    expect(screen.queryByText(/connection reset/)).not.toBeInTheDocument();
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
