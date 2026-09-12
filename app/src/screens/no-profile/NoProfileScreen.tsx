import { SessionScreen } from '../../components/shell/SessionScreen';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { useSignOutAction } from '../../lib/use-sign-out-action';

/** A signed-in account without active organization claims (ADR-0003). */
export default function NoProfileScreen() {
  const { session, signOut } = useAuth();
  const signOutAction = useSignOutAction(signOut);

  return (
    <SessionScreen>
      <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
        Contul tău nu este activ
      </h1>
      <p className="leading-relaxed">
        Ești conectat ca <strong>{session?.user.email}</strong>, dar nu ai
        (încă) un profil activ în organizație, așa că nu îți putem arăta nimic.
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Dacă tocmai ai fost invitat, s-ar putea ca profilul să fie în curs de
        creare — încearcă din nou peste câteva minute. Altfel, scrie-i unui
        membru BC: doar ei pot crea sau reactiva un cont.
      </p>
      <Button
        variant="outline"
        disabled={signOutAction.pending}
        aria-describedby={
          signOutAction.error ? 'no-profile-sign-out-error' : undefined
        }
        onClick={() => void signOutAction.run()}
      >
        {signOutAction.pending ? 'Se deconectează…' : 'Deconectare'}
      </Button>
      {signOutAction.error && (
        <p
          id="no-profile-sign-out-error"
          className="text-sm text-destructive"
          role="alert"
        >
          {signOutAction.error}
        </p>
      )}
    </SessionScreen>
  );
}
