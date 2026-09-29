import { useState, type ReactElement } from 'react';
import { LoaderCircle } from 'lucide-react';
import { describeFailure } from '../../lib/command-reasons';
import { reloadToLatestVersion } from '../../pwa/reload-to-latest';
import {
  ACKNOWLEDGE_FAILED,
  compareNoticeVersions,
  useAcknowledgePrivacyNotice,
  usePrivacyGate,
} from '../../queries/privacy';
import {
  PRIVACY_NOTICE_VERSION,
  PrivacyNoticeContent,
} from '../../screens/privacy/PrivacyNoticeContent';
import { Button } from '../ui/button';
import { SessionLoader, SessionScreen } from './SessionScreen';

/**
 * The Privacy Acknowledgement step after sign-in (#771, ruling L16).
 *
 * A Member without an acknowledgement of the current Privacy Notice version
 * sees the notice full-screen with one button, "Am citit și am înțeles", and
 * nothing of the app until they tap it — once per version. When a migration
 * moves the version (#860), the next read asks again.
 *
 * The server's version can be ahead of the text this bundle carries: a tab
 * left open across a Release, or an installed app still on its cached build.
 * Showing the older text would record nothing (the server answers it stale),
 * so the step says "A apărut o versiune nouă a aplicației" and offers a reload
 * onto the new build. It never locks the Member out: "Mai târziu" opens the
 * app, and the notice is asked for once the new build is running (Audit D,
 * D-19).
 *
 * Like every guard in `App.tsx`, this is kindness, not security: the tap
 * records that the Member was informed; it changes no data and grants
 * nothing. If the check itself cannot be read, the step says so and offers a
 * retry rather than letting the Member past unasked.
 */
export function PrivacyGate({ children }: { children: ReactElement }) {
  const gate = usePrivacyGate();
  const acknowledge = useAcknowledgePrivacyNotice();
  const [later, setLater] = useState(false);
  const [reloading, setReloading] = useState(false);

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

  if (compareNoticeVersions(currentVersion, PRIVACY_NOTICE_VERSION) > 0) {
    if (later) return children;
    return (
      <SessionScreen>
        <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
          A apărut o versiune nouă a aplicației
        </h1>
        <p className="leading-relaxed">
          Politica de confidențialitate are acum versiunea {currentVersion}.
          Reîncarcă aplicația ca să o poți citi și confirma.
        </p>
        <div className="flex flex-col gap-2">
          <Button
            disabled={reloading}
            onClick={() => {
              setReloading(true);
              void reloadToLatestVersion();
            }}
          >
            {reloading && (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            Reîncarcă aplicația
          </Button>
          <Button variant="outline" onClick={() => setLater(true)}>
            Mai târziu
          </Button>
        </div>
      </SessionScreen>
    );
  }

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
          // The version of the text on screen, not the one just read: a build
          // newer than the server's version (the text shipped before its
          // migration ran) is answered stale instead of recording what the
          // server does not yet ask for.
          onClick={() => acknowledge.mutate(PRIVACY_NOTICE_VERSION)}
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
