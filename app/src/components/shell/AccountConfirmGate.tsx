import { useState, type ReactElement } from 'react';
import type { Session } from '@supabase/supabase-js';
import { toAuthErrorMessage } from '../../lib/auth-error-message';
import {
  clearAccountPending,
  forgetSignInRequest,
  isAccountPending,
  usePendingAccount,
} from '../../lib/sign-in-request';
import { supabase } from '../../lib/supabase';
import { ConfirmAccountScreen } from './ConfirmAccountScreen';

/**
 * Holds every guarded route while the session's account waits for the
 * Member's confirmation (`/auth/confirm`, security audit F3). The session is
 * already stored and shared with every tab, so without this a Member who left
 * the confirm page — or had the app open in another tab — would be inside an
 * account they never confirmed.
 */
export function AccountConfirmGate({
  session,
  children,
}: {
  /** The guard's own session, so the gate reads no auth state of its own. */
  session: Session | null;
  children: ReactElement;
}) {
  const pending = usePendingAccount();
  const [error, setError] = useState<string | null>(null);

  if (!session || !isAccountPending(pending, session.user.id)) return children;

  async function refuse() {
    setError(null);
    let failure: unknown = null;
    try {
      ({ error: failure } = await supabase.auth.signOut({ scope: 'local' }));
    } catch (thrown) {
      failure = thrown;
    }
    // Still blocked until the session is really gone.
    if (failure) setError(toAuthErrorMessage(failure));
    else clearAccountPending();
  }

  return (
    <ConfirmAccountScreen
      email={session.user.email ?? ''}
      onContinue={() => {
        forgetSignInRequest();
        clearAccountPending();
      }}
      onRefuse={() => void refuse()}
      error={error}
    />
  );
}
