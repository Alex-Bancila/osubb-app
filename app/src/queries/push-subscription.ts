import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { commandReason, reasonCopy } from '../lib/command-reasons';
import {
  autoEnableDevice,
  pushOnHere,
  pushSupported,
  readDevice,
  repairDevice,
  storeRenewedSubscription,
  subscribeDevice,
  unsubscribeDevice,
  vapidPublicKey,
} from '../lib/push-device';
import { isPushSubscriptionChangedMessage } from '../pwa/push-renewal';
import { keys } from './keys';

export type PushPermission = NotificationPermission | 'unsupported';

/**
 * The **Notificări pe acest dispozitiv** switch (#704, ADR-0010).
 *
 * - `supported`: this browser can receive Web Push at all (on iOS only the
 *   app installed on the home screen can).
 * - `configured`: the build carries `VITE_VAPID_PUBLIC_KEY`.
 * - `permission`: the browser's notification permission; `denied` can only be
 *   undone in the browser's settings.
 * - `subscribed`: a subscription exists here and its `push_tokens` row too
 *   (one `select` on mount). When it does not although the Member turned
 *   push on here and the permission is granted, the self-repair runs first
 *   (`readDevice`, 2026-10-06).
 * - `target`: while a change is in flight, the state it is heading to, so
 *   the switch moves at the tap instead of after the push service answers.
 * - `revoked`: push was on here, but the browser no longer grants the
 *   permission (reset, or revoked on its own): the switch says so.
 * - `enable()` asks for permission, subscribes and stores the row;
 *   `disable()` unsubscribes and deletes it, and records that the Member
 *   turned push off here, so it is not switched on again by itself
 *   (2026-10-06). A failure becomes `error`, in Romanian. The Profil switch
 *   and Acasă's **Pornește notificările** card share it.
 */
export function usePushSubscription() {
  const { session } = useAuth();
  const memberId = session?.user.id;
  const queryClient = useQueryClient();
  const supported = pushSupported();
  const publicKey = vapidPublicKey();
  const [permission, setPermission] = useState<PushPermission>(() =>
    supported ? Notification.permission : 'unsupported',
  );

  // The permission can change while the app is open (the browser's settings,
  // or the browser revoking it on its own): read it again on every return.
  useEffect(() => {
    if (!supported) return;
    const reread = () => setPermission(Notification.permission);
    document.addEventListener('visibilitychange', reread);
    window.addEventListener('focus', reread);
    return () => {
      document.removeEventListener('visibilitychange', reread);
      window.removeEventListener('focus', reread);
    };
  }, [supported]);

  const queryKey = keys.push.device(memberId);
  const device = useQuery({
    queryKey,
    queryFn:
      supported && memberId ? () => readDevice(memberId, publicKey) : skipToken,
  });

  const settle = () => queryClient.invalidateQueries({ queryKey });

  const enableMutation = useMutation({
    mutationFn: async (asked: Promise<NotificationPermission> | null) => {
      if (!asked || !memberId || !publicKey)
        throw new Error('push_not_configured');
      const answer = await asked;
      setPermission(answer);
      // Dismissed or blocked: nothing to subscribe, and not a failure.
      if (answer !== 'granted') return;
      await subscribeDevice(memberId, publicKey);
    },
    onSettled: settle,
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      if (!memberId) return;
      await unsubscribeDevice(memberId, { turnedOff: true });
    },
    onSettled: settle,
  });

  const failed = enableMutation.isError || disableMutation.isError;
  // A refusal the server names -- the five-device cap, a push service it does
  // not accept (security pass M2) -- is said as such; anything else is generic.
  const refusal = reasonCopy(commandReason(enableMutation.error));

  return {
    supported,
    configured: publicKey !== null,
    permission,
    subscribed: device.data === true,
    target: enableMutation.isPending
      ? true
      : disableMutation.isPending
        ? false
        : null,
    revoked:
      supported &&
      memberId !== undefined &&
      permission === 'default' &&
      pushOnHere(memberId),
    /** The first read is still running. */
    loading: device.isLoading,
    /** A switch change is in flight. */
    pending: enableMutation.isPending || disableMutation.isPending,
    error: failed
      ? (refusal ?? reasonCopy('push_subscribe_failed') ?? null)
      : null,
    enable: () => {
      disableMutation.reset();
      // Asked here, in the tap's own call stack: the mutation function runs
      // a microtask later, and Safari and Firefox grant the prompt only to a
      // direct result of the gesture.
      const asked =
        supported && memberId && publicKey
          ? Promise.resolve(Notification.requestPermission())
          : null;
      enableMutation.mutate(asked);
    },
    disable: () => {
      enableMutation.reset();
      disableMutation.mutate();
    },
  };
}

/**
 * How often the self-repair may run again when the app comes back to the
 * foreground. An installed app is resumed far more often than it is reloaded:
 * once per page load left a subscription the browser dropped in the
 * background unrepaired for days (2026-10-06).
 */
export const PUSH_REPAIR_INTERVAL_MS = 10 * 60_000;

/** When each Member's device was last repaired or tried, in this page. */
const lastRepairAt = new Map<string, number>();

/** Forget the guard; for tests only. */
export function resetPushSelfRepairForTests() {
  lastRepairAt.clear();
}

/**
 * Self-repair of this device's Web Push subscription (#769,
 * ADR-0010). Mounted once in the signed-in shell: after the service worker is
 * ready it runs `repairDevice` at app start and again whenever the app comes
 * back to the foreground, at most once per {@link PUSH_REPAIR_INTERVAL_MS},
 * and while the app is open it stores the subscription the worker renewed on
 * `pushsubscriptionchange`. When the repair finds nothing of this Member's to
 * repair, `autoEnableDevice` switches push back on where it was on when this
 * Member's last session here ended and the permission is still granted
 * (2026-10-06).
 * Silent by design: a failure leaves the Profil switch showing the true state
 * and is tried again at the next start.
 */
export function usePushSelfRepair() {
  const { session } = useAuth();
  const memberId = session?.user.id;
  const queryClient = useQueryClient();

  useEffect(() => {
    const publicKey = vapidPublicKey();
    if (!memberId || !publicKey || !pushSupported()) return;
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: keys.push.device(memberId) });

    const repair = () => {
      const last = lastRepairAt.get(memberId);
      if (last !== undefined && Date.now() - last < PUSH_REPAIR_INTERVAL_MS)
        return;
      lastRepairAt.set(memberId, Date.now());
      repairDevice(memberId, publicKey)
        .then((outcome) =>
          outcome === 'skipped'
            ? autoEnableDevice(memberId, publicKey)
            : outcome,
        )
        .then(
          (outcome) => {
            if (outcome === 'repaired' || outcome === 'enabled') void refresh();
          },
          () => undefined,
        );
    };
    repair();
    const onVisible = () => {
      if (document.visibilityState === 'visible') repair();
    };
    document.addEventListener('visibilitychange', onVisible);

    const onMessage = (event: MessageEvent) => {
      if (!isPushSubscriptionChangedMessage(event.data)) return;
      storeRenewedSubscription(
        memberId,
        event.data.subscription,
        event.data.oldSubscription,
      ).then(
        (stored) => {
          if (stored) void refresh();
        },
        () => undefined,
      );
    };
    const worker = navigator.serviceWorker;
    worker.addEventListener('message', onMessage);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      worker.removeEventListener('message', onMessage);
    };
  }, [memberId, queryClient]);
}
