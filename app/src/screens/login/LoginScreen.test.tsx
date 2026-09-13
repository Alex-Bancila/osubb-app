import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ signInWithOtp: vi.fn() }));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithOtp: auth.signInWithOtp } },
}));
import LoginScreen from './LoginScreen';

describe('LoginScreen', () => {
  it('moves focus to the confirmation heading after sending a magic link', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: null });
    render(<LoginScreen />);

    fireEvent.input(screen.getByLabelText('Email'), {
      target: { value: 'MEMBRU@EXEMPLU.RO' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Trimite linkul' }));

    const heading = await screen.findByRole('heading', {
      name: 'Verifică-ți emailul',
    });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});
