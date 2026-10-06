import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useAuth } from '../../lib/auth';
import { useSignOutAction } from '../../lib/use-sign-out-action';

export const SIGN_OUT_LINK = 'Deconectează-te de pe acest dispozitiv';

/**
 * The app's one way out (R41, Alex 2026-10-07: "remove the disconnect button
 * for everyone"): a quiet line at the foot of Profil, never a button in the
 * chrome. It asks first, since coming back costs a new emailed link; a failed
 * sign-out keeps the dialog open with the retry line and the button unlocked.
 * The no-active-profile screen keeps its own button, so nobody is stuck.
 */
export function SignOutDeviceLink() {
  const { signOut } = useAuth();
  const signOutAction = useSignOutAction(signOut);
  const [open, setOpen] = useState(false);
  // An error belongs to the attempt in this opening, not to a later one.
  const [attempted, setAttempted] = useState(false);
  const busy = signOutAction.pending;

  return (
    <div className="flex justify-center border-t border-border pt-4">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
        }}
      >
        <Button
          type="button"
          variant="link"
          size="sm"
          className="gap-1.5 font-normal text-muted-foreground hover:text-foreground"
          onClick={() => {
            setAttempted(false);
            setOpen(true);
          }}
        >
          <LogOut aria-hidden="true" />
          {SIGN_OUT_LINK}
        </Button>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Te deconectezi de pe acest dispozitiv?</DialogTitle>
            <DialogDescription>
              Vei avea nevoie de un nou link de conectare pe email.
            </DialogDescription>
          </DialogHeader>
          {attempted && signOutAction.error && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {signOutAction.error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Renunță
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={async () => {
                setAttempted(true);
                if (await signOutAction.run()) setOpen(false);
              }}
            >
              {busy ? 'Se deconectează…' : 'Deconectează-te'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
