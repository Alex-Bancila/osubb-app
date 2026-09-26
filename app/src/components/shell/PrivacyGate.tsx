import type { ReactElement } from 'react';
import { LoaderCircle } from 'lucide-react';
import { describeFailure } from '../../lib/command-reasons';
import {
  ACKNOWLEDGE_FAILED,
  useAcknowledgePrivacyNotice,
  usePrivacyGate,
} from '../../queries/privacy';
import { PrivacyNoticeContent } from '../../screens/privacy/PrivacyNoticeContent';
import { Button } from '../ui/button';
import { SessionLoader, SessionScreen } from './SessionScreen';

/**
 * The Privacy Acknowledgement step after sign-in (#771, ruling L16).
 *
 * A Member without an acknowledgement of the current Privacy Notice version
 * sees the notice full-screen with one button, "Am citit și am înțeles", and
 * nothing of the app until they tap it — once per version. When BC raises the
 * version, the next read asks again.
 *
 * Like every guard in `App.tsx`, this is kindness, not security: the tap
 * records that the Member was informed; it changes no data and grants
 * nothing. If the check itself cannot be read, the step says so and offers a
 * retry rather than letting the Member past unasked.
 */
export function PrivacyGate({ children }: { children: ReactElement }) {
  const gate = usePrivacyGate();
  const acknowledge = useAcknowledgePrivacyNotice();

  if (gate.isPending)
    return (
      <SessionScreen centered>
        <SessionLoader label="Se încarcă" />
      </SessionScreen>
    );

  // A failed background re-read keeps the last answer: a dropped connection
  // must not throw a Member who already acknowledged out of the app.
  if (gate.data === undefined)
    return (
      <SessionScreen>
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
          Nu am putut încărca aplicația
        </h1>
        <p role="alert" className="leading-relaxed">
          Verifică internetul și încearcă din nou.
        </p>
        <Button onClick={() => void gate.refetch()}>Încearcă din nou</Button>
      </SessionScreen>
    );

  const { currentVersion, acknowledged } = gate.data;
  if (acknowledged || currentVersion === null) return children;

  return (
    <SessionScreen wide>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Înainte să intri în aplicație, citește cum folosim datele tale. Îți
        cerem asta o singură dată pentru fiecare versiune a politicii.
      </p>
      <PrivacyNoticeContent />
      <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 bg-card px-1 pt-3 pb-1">
        {acknowledge.isError && (
          <p
            id="privacy-gate-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {describeFailure(acknowledge.error, ACKNOWLEDGE_FAILED).message}
          </p>
        )}
        <Button
          className="w-full"
          disabled={acknowledge.isPending}
          aria-describedby={
            acknowledge.isError ? 'privacy-gate-error' : undefined
          }
          onClick={() => acknowledge.mutate(currentVersion)}
        >
          {acknowledge.isPending && (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          Am citit și am înțeles
        </Button>
      </div>
    </SessionScreen>
  );
}
