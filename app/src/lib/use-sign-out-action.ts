import { useCallback, useRef, useState } from 'react';

const SIGN_OUT_ERROR = 'Nu te-am putut deconecta. Încearcă din nou.';

/**
 * One sign-out, never two at once, with a Romanian retry line on failure.
 * `run` resolves `true` once the session is gone, so a confirmation can close
 * itself; `false` when it failed or another run was already under way.
 */
export function useSignOutAction(action: () => Promise<void>) {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async (): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setPending(true);
    setError('');

    try {
      await action();
      return true;
    } catch {
      setError(SIGN_OUT_ERROR);
      return false;
    } finally {
      running.current = false;
      setPending(false);
    }
  }, [action]);

  return { run, pending, error };
}
