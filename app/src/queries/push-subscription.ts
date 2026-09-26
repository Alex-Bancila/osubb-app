import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { reasonCopy } from '../lib/command-reasons';
import {
  isDeviceSubscribed,
  pushSupported,
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
 *   (one `select` on mount).
 * - `enable()` asks for permission, subscribes and stores the row;
 *   `disable()` unsubscribes and deletes it. A failure becomes `error`, in
 *   Romanian.
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

  const queryKey = keys.push.device(memberId);
  const device = useQuery({
    queryKey,
    queryFn:
      supported && memberId ? () => isDeviceSubscribed(memberId) : skipToken,
  });

  const settle = () => queryClient.invalidateQueries({ queryKey });

  const enableMutation = useMutation({
    mutationFn: async () => {
      if (!memberId || !publicKey) throw new Error('push_not_configured');
      const answer = await Notification.requestPermission();
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
      await unsubscribeDevice(memberId);
    },
    onSettled: settle,
  });

  const failed = enableMutation.isError || disableMutation.isError;

  return {
    supported,
    configured: publicKey !== null,
    permission,
    subscribed: device.data === true,
    /** The first read is still running. */
    loading: device.isLoading,
    /** A switch change is in flight. */
    pending: enableMutation.isPending || disableMutation.isPending,
    error: failed ? (reasonCopy('push_subscribe_failed') ?? null) : null,
    enable: () => {
      disableMutation.reset();
      enableMutation.mutate();
    },
    disable: () => {
      enableMutation.reset();
      disableMutation.mutate();
    },
  };
}

/** Members whose device this page load has already repaired or tried to. */
const repairedThisLoad = new Set<string>();

/** Forget the once-per-load guard; for tests only. */
export function resetPushSelfRepairForTests() {
  repairedThisLoad.clear();
}

/**
 * App-start self-repair of this device's Web Push subscription (#769,
 * ADR-0010). Mounted once in the signed-in shell: after the service worker is
 * ready it runs `repairDevice` once per page load, and while the app is open
 * it stores the subscription the worker renewed on `pushsubscriptionchange`.
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

    if (!repairedThisLoad.has(memberId)) {
      repairedThisLoad.add(memberId);
      repairDevice(memberId, publicKey).then(
        (outcome) => {
          if (outcome === 'repaired') void refresh();
        },
        () => undefined,
      );
    }

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
    return () => worker.removeEventListener('message', onMessage);
  }, [memberId, queryClient]);
}
