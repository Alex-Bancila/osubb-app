import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
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
  nickname: 'Ani',
  role: 'voluntar',
  status: 'activ',
  avatar_color: '#284C93',
  joined_year: 2025,
  joined_at: '2025-01-01',
  email: 'ana@osubb.ro',
  phone: '0711223344',
};

const NICKNAME_RULE =
  '2–24 de caractere: litere, cifre, spații, punct, cratimă sau underscore. Fără pseudonim, se afișează numele complet.';

function wrapper(queryClient = new QueryClient()) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function renderSheet(
  profile: MyProfile = sampleProfile,
  onClose: () => void = vi.fn(),
) {
  return render(
    <EditProfileSheet open={true} onClose={onClose} profile={profile} />,
    { wrapper: wrapper() },
  );
}

const nicknameInput = () => screen.getByLabelText('Pseudonim');
const phoneInput = () => screen.getByLabelText(/număr de telefon/i);
const save = () =>
  userEvent.click(
    screen.getByRole('button', { name: /salvează modificările/i }),
  );

describe('EditProfileSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateProfileMock.mockResolvedValue(undefined);
  });

  it('edits the Nickname, the phone and the colour; email and full name are locked', async () => {
    renderSheet();

    expect(nicknameInput()).toHaveValue('Ani');
    expect(nicknameInput()).toHaveAccessibleDescription(NICKNAME_RULE);
    expect(phoneInput()).toHaveValue('0711223344');
    expect(
      screen.getByText(
        /numărul de telefon este vizibil doar pentru tine și membrii cu nivel ≥5/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Alege culoarea avatarului' }),
    ).toBeInTheDocument();

    const emailInput = screen.getByLabelText(/adresă de email/i);
    expect(emailInput).toHaveValue('ana@osubb.ro');
    expect(emailInput).toBeDisabled();

    expect((await axe.run(screen.getByRole('dialog'))).violations).toEqual([]);
  });

  it('shows the full name read-only with the BC note, whoever edits (#675, R5)', () => {
    renderSheet();

    const nameInput = screen.getByLabelText('Nume complet');
    expect(nameInput).toHaveValue('Ana Popescu');
    expect(nameInput).toHaveAttribute('readonly');
    expect(nameInput).toHaveAccessibleDescription(
      'Numele complet se schimbă doar de BC sau Moderator.',
    );
  });

  it('sends only nickname, phone and avatarColor -- never a full name', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderSheet(sampleProfile, onClose);

    await user.clear(nicknameInput());
    await user.type(nicknameInput(), 'Anișoara');
    await user.clear(phoneInput());
    await user.type(phoneInput(), '0799001122');
    await user.click(screen.getByRole('button', { name: /roșu osubb/i }));
    await user.click(
      screen.getByRole('button', { name: /salvează modificările/i }),
    );

    expect(updateProfileMock).toHaveBeenCalledTimes(1);
    const payload = updateProfileMock.mock.calls[0]?.[0] as object;
    expect(payload).toEqual({
      nickname: 'Anișoara',
      phone: '+40799001122',
      avatarColor: '#ED2025',
    });
    expect(Object.keys(payload).sort()).toEqual([
      'avatarColor',
      'nickname',
      'phone',
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  describe('Nickname', () => {
    it('accepts edge whitespace and sends the trimmed Nickname', async () => {
      const user = userEvent.setup();
      renderSheet();

      await user.clear(nicknameInput());
      await user.type(nicknameInput(), '  Ani P.  ');
      await user.tab();
      expect(nicknameInput()).not.toHaveAttribute('aria-invalid');

      await save();
      expect(updateProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({ nickname: 'Ani P.' }),
      );
    });

    it('refuses 1 character on blur and on submit', async () => {
      const user = userEvent.setup();
      renderSheet();

      await user.clear(nicknameInput());
      await user.type(nicknameInput(), 'A');
      await user.tab();
      expect(nicknameInput()).toHaveAttribute('aria-invalid', 'true');
      expect(nicknameInput()).toHaveAccessibleDescription(
        `${NICKNAME_RULE} Pseudonimul are cel puțin 2 caractere.`,
      );

      await save();
      expect(updateProfileMock).not.toHaveBeenCalled();
      expect(nicknameInput()).toHaveFocus();
    });

    it('refuses 25 characters', async () => {
      const user = userEvent.setup();
      renderSheet();

      await user.clear(nicknameInput());
      await user.type(nicknameInput(), 'a'.repeat(25));
      await save();

      expect(updateProfileMock).not.toHaveBeenCalled();
      expect(nicknameInput()).toHaveAccessibleDescription(
        /Pseudonimul are cel mult 24 de caractere\./,
      );
    });

    it('refuses a disallowed character', async () => {
      const user = userEvent.setup();
      renderSheet();

      await user.clear(nicknameInput());
      await user.type(nicknameInput(), 'Ani!');
      await user.tab();

      expect(nicknameInput()).toHaveAccessibleDescription(
        /Pseudonimul poate avea doar litere, cifre, spații, punct, cratimă sau underscore\./,
      );
      await save();
      expect(updateProfileMock).not.toHaveBeenCalled();
    });

    it('clears the Nickname when it is emptied', async () => {
      const user = userEvent.setup();
      renderSheet();

      await user.clear(nicknameInput());
      await user.type(nicknameInput(), '   ');
      await save();

      expect(updateProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({ nickname: null }),
      );
    });

    it('puts a server reason under the Nickname field', async () => {
      const user = userEvent.setup();
      updateProfileMock.mockRejectedValueOnce({
        code: '23514',
        message: 'nickname_taken',
      });
      renderSheet();

      await user.clear(nicknameInput());
      await user.type(nicknameInput(), 'Ionuț');
      await save();

      expect(updateProfileMock).toHaveBeenCalled();
      expect(nicknameInput()).toHaveAccessibleDescription(
        /Pseudonimul este deja folosit de alt membru\. Alege altul\./,
      );
      expect(nicknameInput()).toHaveFocus();
      // Under the field, not in the form-level slot.
      expect(screen.queryByText(/nickname_taken/)).not.toBeInTheDocument();
    });
  });

  describe('phone (R8)', () => {
    it.each([
      ['0730 655 145', '+40730655145'],
      ['+40 0730655145', '+40730655145'],
      ['0040 (730) 655-145', '+40730655145'],
      ['0730.655.145', '+40730655145'],
      ['+373 069123456', '+37369123456'],
      ['+44 20 7946 0958', '+442079460958'],
    ])(
      'normalises %s to %s, shows it back and sends it',
      async (typed, e164) => {
        const user = userEvent.setup();
        renderSheet();

        await user.clear(phoneInput());
        await user.type(phoneInput(), typed);
        await user.tab();
        expect(phoneInput()).toHaveValue(e164);

        await save();
        expect(updateProfileMock).toHaveBeenCalledWith(
          expect.objectContaining({ phone: e164 }),
        );
      },
    );

    it('submits null phone when the phone is cleared', async () => {
      const user = userEvent.setup();
      renderSheet();

      await user.clear(phoneInput());
      await save();

      expect(updateProfileMock).toHaveBeenCalledWith({
        nickname: 'Ani',
        phone: null,
        avatarColor: '#284C93',
      });
    });

    it('refuses a number the server would refuse and puts the server phone_invalid under it', async () => {
      const user = userEvent.setup();
      updateProfileMock.mockRejectedValueOnce({
        code: '23514',
        message: 'phone_invalid',
      });
      renderSheet();

      await user.clear(phoneInput());
      await user.type(phoneInput(), '0630 655 145');
      await user.tab();
      // An unreadable number stays as typed, with the rule under it.
      expect(phoneInput()).toHaveValue('0630 655 145');
      expect(phoneInput()).toHaveAccessibleDescription(
        /Scrie un număr de telefon valid \(de exemplu 0730 655 145\)\./,
      );

      await user.clear(phoneInput());
      await user.type(phoneInput(), '+40 0730 655 145');
      await save();
      expect(updateProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+40730655145' }),
      );
      expect(phoneInput()).toHaveAccessibleDescription(
        /Scrie un număr de telefon valid/,
      );
      expect(phoneInput()).toHaveFocus();
    });
  });

  it('renders an error alert when the profile update fails', async () => {
    updateProfileMock.mockRejectedValueOnce({
      code: 'XX000',
      message: 'connection reset by peer',
    });
    renderSheet();

    await save();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Nu am putut salva modificările.',
    );
    expect(screen.queryByText(/connection reset/)).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderSheet(sampleProfile, onClose);

    await user.click(screen.getByRole('button', { name: /închide/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
