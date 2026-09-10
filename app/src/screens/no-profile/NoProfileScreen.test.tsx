import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('../../lib/auth', () => ({ useAuth: auth.useAuth }));
vi.mock('@ionic/react', () => ({
  IonButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  IonContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  IonPage: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import NoProfileScreen from './NoProfileScreen';

describe('NoProfileScreen sign-out', () => {
  it('keeps the authenticated account visible and offers retry after failure', async () => {
    const signOut = vi
      .fn()
      .mockRejectedValue(new Error('provider failure for private account'));
    auth.useAuth.mockReturnValue({
      session: { user: { email: 'membru@osubb.ro' } },
      signOut,
    });
    render(<NoProfileScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Deconectare' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nu te-am putut deconecta. Încearcă din nou.',
    );
    expect(screen.getByText('membru@osubb.ro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deconectare' })).toBeEnabled();
    expect(screen.queryByText(/provider failure|private account/i)).toBeNull();
  });
});
