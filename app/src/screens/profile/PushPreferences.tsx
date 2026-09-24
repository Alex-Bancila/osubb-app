import { useId } from 'react';
import { Switch } from '../../components/ui/switch';
import {
  MUTABLE_PUSH_KINDS,
  type MutablePushKind,
  usePushPreferences,
} from '../../queries/push-preferences';

const KIND_COPY: Record<MutablePushKind, string> = {
  announce: 'Anunțuri',
  event: 'Evenimente',
  deadline: 'Termene limită',
};

/**
 * Per-kind push preferences (#635, ruling R17), inside the **Notificări pe
 * acest dispozitiv** card. They belong to the Member, not the browser, so
 * they apply to every device and show even where this one cannot subscribe.
 * Muting a kind never touches the in-app list.
 */
export function PushPreferences() {
  const push = usePushPreferences();
  const titleId = useId();
  const baseId = useId();

  return (
    <div
      className="mt-4 border-t pt-4"
      role="group"
      aria-labelledby={titleId}
      data-testid="push-preferences"
    >
      <h4 id={titleId} className="text-sm font-semibold">
        Ce primești ca notificare push
      </h4>
      <p className="mt-1 text-sm text-muted-foreground">
        Pe toate dispozitivele tale. Lista din aplicație rămâne completă.
      </p>

      <ul className="mt-3 space-y-3">
        {MUTABLE_PUSH_KINDS.map((kind) => {
          const labelId = `${baseId}-${kind}`;
          return (
            <li key={kind} className="flex items-center justify-between gap-4">
              <span id={labelId} className="text-sm">
                {KIND_COPY[kind]}
              </span>
              <Switch
                aria-labelledby={labelId}
                checked={push.preferences[kind]}
                disabled={push.loading || push.pendingKind === kind}
                onCheckedChange={(next) => push.setPreference(kind, next)}
              />
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-sm text-muted-foreground">
        Ajung mereu: notificările despre Taskuri, cele de sistem și anunțurile
        critice.
      </p>

      {push.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {push.error}
        </p>
      )}
    </div>
  );
}
