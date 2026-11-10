import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { reloadToLatestVersion } from './reload-to-latest';
import { watchForUpdates } from './update-checks';

function PwaUpdatePrompt() {
  const [updating, setUpdating] = useState(false);
  // An app left open or brought back looks for a new build (#1137).
  const stopWatching = useRef<(() => void) | null>(null);
  // Registration resolves after the first render: one that lands once the
  // prompt is gone starts nothing.
  const mounted = useRef(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration || !mounted.current) return;
      stopWatching.current?.();
      stopWatching.current = watchForUpdates(registration);
    },
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopWatching.current?.();
      stopWatching.current = null;
    };
  }, []);

  if (!needRefresh) return null;

  // Not the plugin's updateServiceWorker(): it only messages a waiting
  // worker and reloads on a controller change. A page opened before any
  // worker existed (an installed app's first launch) is never controlled, so
  // a build found while it stays open is already active: nothing waits and
  // no controller changes, and the tap did nothing. The helper hands over to
  // a waiting build or, with nothing waiting, reloads onto the active one.
  function applyUpdate() {
    setUpdating(true);
    void reloadToLatestVersion();
  }

  return (
    <div className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 w-[calc(100%-2rem)] max-w-sm lg:bottom-[calc(1rem+env(safe-area-inset-bottom))]">
      <Alert className="bg-card shadow-lg">
        <AlertTitle>Actualizare disponibilă</AlertTitle>
        <AlertDescription>
          O versiune nouă a aplicației este disponibilă.
        </AlertDescription>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={applyUpdate} disabled={updating}>
            {updating ? 'Se actualizează…' : 'Actualizează aplicația'}
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
