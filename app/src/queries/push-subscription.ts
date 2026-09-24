import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { reasonCopy } from '../lib/command-reasons';
import {
  isDeviceSubscribed,
  pushSupported,
  subscribeDevice,
  unsubscribeDevice,
  vapidPublicKey,
} from '../lib/push-device';
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
