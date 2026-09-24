import { BellRing } from 'lucide-react';
import { useId } from 'react';
import { Switch } from '../../components/ui/switch';
import { usePushSubscription } from '../../queries/push-subscription';

/**
 * **Notificări pe acest dispozitiv** (#704, ADR-0010): whether this browser
 * receives Web Push. Self-contained, so it survives the Profil rebuild (#699),
 * and the card #635 adds its per-kind switches to.
 */
export function PushDeviceCard() {
  const push = usePushSubscription();
  const titleId = useId();
  const statusId = useId();

  const unsupported = !push.supported;
  const denied = !unsupported && push.permission === 'denied';
  const unconfigured = !unsupported && !denied && !push.configured;
  const checked = !unsupported && !denied && push.subscribed;

  const status = unsupported
    ? 'Instalează aplicația pe ecranul principal pentru a primi notificări'
    : denied
      ? 'Notificările sunt blocate din setările browserului'
      : unconfigured
        ? 'Notificările pe dispozitiv nu sunt disponibile încă'
        : checked
          ? 'Primești notificări pe acest dispozitiv'
          : 'Nu primești notificări pe acest dispozitiv';

  return (
    <section
      className="card p-6"
      aria-labelledby={titleId}
      data-testid="push-device-card"
    >
      <div className="card-head">
        <h3 id={titleId} className="card-title flex items-center gap-2">
          <BellRing className="size-5 text-primary" aria-hidden="true" />
          <span>Notificări pe acest dispozitiv</span>
        </h3>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p id={statusId} className="text-sm text-muted-foreground">
          {status}
        </p>
        <Switch
          aria-labelledby={titleId}
          aria-describedby={statusId}
          checked={checked}
          disabled={
            unsupported ||
            denied ||
            unconfigured ||
            push.loading ||
            push.pending
          }
          onCheckedChange={(next) => (next ? push.enable() : push.disable())}
        />
      </div>

      {push.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {push.error}
        </p>
      )}
    </section>
  );
}
