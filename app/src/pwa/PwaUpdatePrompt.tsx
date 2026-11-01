import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { watchForUpdates } from './update-checks';

function PwaUpdatePrompt() {
  const [updateError, setUpdateError] = useState(false);
  // An app left open or brought back looks for a new build (#1137).
  const stopWatching = useRef<(() => void) | null>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      stopWatching.current?.();
      stopWatching.current = watchForUpdates(registration);
    },
  });
  useEffect(
    () => () => {
      stopWatching.current?.();
      stopWatching.current = null;
    },
    [],
  );

  if (!needRefresh) return null;

  async function applyUpdate() {
    setUpdateError(false);
    try {
      await updateServiceWorker(true);
    } catch {
      setUpdateError(true);
    }
  }

  return (
    <div className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 w-[calc(100%-2rem)] max-w-sm lg:bottom-[calc(1rem+env(safe-area-inset-bottom))]">
      <Alert className="bg-card shadow-lg">
        <AlertTitle>Actualizare disponibilă</AlertTitle>
        <AlertDescription>
          O versiune nouă a aplicației este disponibilă.
        </AlertDescription>
        {updateError && (
          <p className="mt-2 text-sm text-destructive">
            Nu am putut actualiza aplicația. Verifică internetul și încearcă din
            nou.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => void applyUpdate()}>
            Actualizează aplicația
          </Button>
          <Button variant="outline" onClick={() => setNeedRefresh(false)}>
            Mai târziu
          </Button>
        </div>
      </Alert>
    </div>
  );
}

export { PwaUpdatePrompt };
