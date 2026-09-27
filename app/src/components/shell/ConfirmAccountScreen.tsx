import { Button } from '../ui/button';
import { SessionScreen } from './SessionScreen';

/**
 * "Is this your account?" — shown when a link signed this browser in without
 * a request from it (security audit F3). The address is the verified one from
 * the session, never the link's.
 */
export function ConfirmAccountScreen({
  email,
  onContinue,
  onRefuse,
  error,
}: {
  email: string;
  onContinue: () => void;
  onRefuse: () => void;
  /** Why the last refusal could not finish. */
  error?: string | null;
}) {
  return (
    <SessionScreen>
      <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
        Confirmă contul
      </h1>
      <p className="leading-relaxed">
        Linkul te-a conectat ca <strong>{email}</strong>.
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Continuă doar dacă aceasta este adresa ta.
      </p>
      <Button type="button" className="w-full" onClick={onContinue}>
        Continuă
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onRefuse}
      >
        Nu este adresa mea
      </Button>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </SessionScreen>
  );
}
