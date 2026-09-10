import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ signInWithOtp: vi.fn() }));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithOtp: auth.signInWithOtp } },
}));
vi.mock('@ionic/react', () => ({
  IonButton: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  IonContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  IonInput: ({
    label,
    onIonInput,
    required,
    value,
    type,
    placeholder,
  }: Record<string, unknown>) => (
    <label>
      {String(label)}
      <input
        required={Boolean(required)}
        value={String(value)}
        type={String(type)}
        placeholder={String(placeholder)}
        onInput={(event) =>
          (onIonInput as (event: { detail: { value: string } }) => void)({
            detail: { value: event.currentTarget.value },
          })
        }
      />
    </label>
  ),
  IonPage: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  IonSpinner: () => null,
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
