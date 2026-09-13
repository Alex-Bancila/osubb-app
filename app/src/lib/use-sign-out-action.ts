import { useCallback, useRef, useState } from 'react';

const SIGN_OUT_ERROR = 'Nu te-am putut deconecta. Încearcă din nou.';

export function useSignOutAction(action: () => Promise<void>) {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError('');

    try {
      await action();
    } catch {
      setError(SIGN_OUT_ERROR);
    } finally {
      running.current = false;
      setPending(false);
    }
  }, [action]);

  return { run, pending, error };
}
