import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSignOutAction } from './use-sign-out-action';

function SignOutHarness({ action }: { action: () => Promise<void> }) {
  const signOut = useSignOutAction(action);
  return (
    <>
      <button disabled={signOut.pending} onClick={() => void signOut.run()}>
        {signOut.pending ? 'Se deconectează…' : 'Deconectare'}
      </button>
      {signOut.error && <p role="alert">{signOut.error}</p>}
    </>
  );
}

function deferredAction() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useSignOutAction', () => {
  it('prevents another sign-out while the first request is pending', async () => {
    const deferred = deferredAction();
    const action = vi.fn(() => deferred.promise);
    render(<SignOutHarness action={action} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deconectare' }));
    const pending = screen.getByRole('button', { name: 'Se deconectează…' });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(action).toHaveBeenCalledTimes(1);

    deferred.resolve();
    await waitFor(() => expect(pending).not.toBeDisabled());
  });

  it('shows a Romanian retry message without provider details after failure', async () => {
    const action = vi
      .fn()
      .mockRejectedValue(
        new Error('AuthApiError: network route and account details'),
      );
    render(<SignOutHarness action={action} />);

    fireEvent.click(screen.getByRole('button', { name: 'Deconectare' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Nu te-am putut deconecta. Încearcă din nou.',
    );
    expect(alert).not.toHaveTextContent(/AuthApiError|network|account/i);
    expect(screen.getByRole('button', { name: 'Deconectare' })).toBeEnabled();
  });
});
