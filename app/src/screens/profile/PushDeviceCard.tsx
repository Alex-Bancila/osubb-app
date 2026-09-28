import { SwitchRow } from '../../components/ui/switch';
import { usePushSubscription } from '../../queries/push-subscription';
import { PushPreferences } from './PushPreferences';

/**
 * **Notificări pe acest dispozitiv** (#704, ADR-0010): whether this browser
 * receives Web Push, and below it the Member's per-kind switches (#635).
 * The body of Profil's panel of that name (#824): the page owns the panel
 * and its header, so the switch carries the name itself.
 */
export function PushDeviceCard() {
  const push = usePushSubscription();

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
    <div data-testid="push-device-card">
      {/* One 44 px row: the label, the state, and the switch (X13). */}
      <SwitchRow
        label="Notificări push"
        description={status}
        checked={checked}
        disabled={
          unsupported || denied || unconfigured || push.loading || push.pending
        }
        onCheckedChange={(next) => (next ? push.enable() : push.disable())}
      />

      {push.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {push.error}
        </p>
      )}

      <PushPreferences />
    </div>
  );
}
