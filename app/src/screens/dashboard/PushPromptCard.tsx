import { useEffect, useId, useState } from 'react';
import { Bell, BellOff, Check, Share, SquarePlus } from 'lucide-react';
import { cn } from 'cn';
import { panelBoxClass } from '../../components/layout/Panel';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import {
  isAppleMobile,
  isIpad,
  pushPromptKind,
  pushPromptSnoozed,
  runsInstalled,
  snoozePushPrompt,
} from '../../lib/push-prompt';
import { usePushSubscription } from '../../queries/push-subscription';

/** How long the "pornite" receipt stays before the card is gone. */
export const PUSH_PROMPT_RECEIPT_MS = 6_000;

/** The red bell tile both cards open with; it swings once (motion-safe). */
function Glyph({ icon: Icon }: { icon: typeof Bell }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-sm bg-(--red-050) text-(--red-600)"
    >
      <Icon className="push-prompt-glyph size-5" />
    </span>
  );
}

/**
 * **Pornește notificările** on Acasă (2026-10-06, Alex: "is there any way in
 * which i can set by default the notification as approved and on?" → "i
 * want to add both"). A browser asks for the notification permission only
 * after a tap, so the first screen offers that tap once, instead of leaving
 * it to the switch in Profil:
 *
 * - **Pornește** runs the Profil switch's own enable (`usePushSubscription`),
 *   which asks for the permission in the tap's call stack. Granted: a short
 *   receipt, then the card is gone. Blocked: one quiet line on how to allow
 *   it later, and the card never comes back (the permission is `denied`).
 * - **Mai târziu** hides it for a week on this device.
 * - On an iPhone or iPad in a browser tab, where push cannot work, it shows
 *   instead how to add the app to the home screen.
 *
 * Where the permission is already granted the shell switches push on by
 * itself (`autoEnableDevice`), so there is nothing to ask. Sized to its
 * content: one row on a laptop, the buttons below the text on a phone.
 */
export default function PushPromptCard() {
  const { session } = useAuth();
  const memberId = session?.user.id;
  const push = usePushSubscription();
  const [snoozed, setSnoozed] = useState(() =>
    memberId ? pushPromptSnoozed(memberId) : false,
  );
  // Set by the tap: from then on the card follows the answer, not the
  // visibility rule (which hides it as soon as the permission is answered).
  const [asked, setAsked] = useState(false);
  const [receiptDone, setReceiptDone] = useState(false);
  const headingId = useId();

  const kind = pushPromptKind({
    configured: push.configured,
    supported: push.supported,
    permission: push.permission,
    subscribed: push.subscribed,
    loading: push.loading,
    snoozed,
    appleMobile: isAppleMobile(),
    installed: runsInstalled(),
  });

  const blocked = asked && push.permission === 'denied';
  // Granted and stored without an error: the device read that follows can
  // lag a moment, and the card must not flash its buttons back meanwhile.
  const enabled =
    asked && !push.pending && push.permission === 'granted' && !push.error;

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(
      () => setReceiptDone(true),
      PUSH_PROMPT_RECEIPT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [enabled]);

  if (!memberId) return null;

  const later = () => {
    snoozePushPrompt(memberId);
    setSnoozed(true);
  };

  if (enabled) {
    if (receiptDone) return null;
    return (
      <p
        role="status"
        className="push-prompt-receipt flex items-center gap-2 text-sm font-semibold text-(--success)"
      >
        <Check aria-hidden="true" className="size-4 shrink-0" />
        Notificările sunt pornite pe acest dispozitiv.
      </p>
    );
  }

  if (blocked) {
    return (
      <p
        role="status"
        className="flex items-start gap-2 text-sm text-muted-foreground"
      >
        <BellOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Notificările sunt blocate pe acest dispozitiv. Le poți permite din
        setările browserului, apoi le pornești din Profil.
      </p>
    );
  }

  if (!asked && kind === null) return null;

  if (kind === 'install') {
    const device = isIpad() ? 'iPad' : 'iPhone';
    return (
      <section
        aria-labelledby={headingId}
        data-testid="push-prompt"
        className={cn(panelBoxClass, 'flex gap-3')}
      >
        <Glyph icon={Bell} />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <h2
              id={headingId}
              className="m-0 text-[length:var(--fs-md)] leading-snug font-bold"
            >
              Adaugă OSUBB pe ecranul principal
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {`Pe ${device}, notificările despre Taskuri, Evenimente și Anunțuri ajung doar în aplicația deschisă de pe ecranul principal.`}
            </p>
          </div>
          <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            <li className="flex items-center gap-2">
              <Step n={1} />
              <span>
                Atinge butonul de partajare <Keycap icon={Share} /> din Safari.
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Step n={2} />
              <span>
                Alege{' '}
                <Keycap label="Adaugă pe ecranul principal" icon={SquarePlus} />
                .
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Step n={3} />
              <span>
                Deschide OSUBB de pe ecranul principal și pornește notificările.
              </span>
            </li>
          </ol>
          <div>
            <Button variant="outline" onClick={later}>
              Mai târziu
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="push-prompt"
      className={cn(
        panelBoxClass,
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <Glyph icon={Bell} />
        <div className="min-w-0">
          <h2
            id={headingId}
            className="m-0 text-[length:var(--fs-md)] leading-snug font-bold"
          >
            Pornește notificările
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Află pe loc de Taskuri, Evenimente și Anunțuri noi, chiar cu
            aplicația închisă.
          </p>
          {push.error && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {push.error}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 pl-13 sm:pl-0">
        <Button
          onClick={() => {
            setAsked(true);
            push.enable();
          }}
          disabled={push.pending}
        >
          {push.pending ? 'Se pornesc…' : 'Pornește'}
        </Button>
        <Button variant="outline" onClick={later} disabled={push.pending}>
          Mai târziu
        </Button>
      </div>
    </section>
  );
}

/** The step's number, as the list's own order (a real sequence). */
function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-muted-foreground tabular-nums"
    >
      {n}
    </span>
  );
}

/**
 * The control as iOS draws it — its glyph in the system blue, and its name
 * when it has one on screen — so the Member finds it. The share button has
 * only the glyph, which the sentence around it already names.
 */
function Keycap({ label, icon: Icon }: { label?: string; icon: typeof Share }) {
  return (
    <span
      aria-hidden={label ? undefined : 'true'}
      className="inline-flex items-center gap-1 rounded-xs border border-border bg-background px-1.5 py-0.5 align-middle text-xs font-semibold whitespace-nowrap"
    >
      <Icon aria-hidden="true" className="size-3.5 text-(--info)" />
      {label}
    </span>
  );
}
