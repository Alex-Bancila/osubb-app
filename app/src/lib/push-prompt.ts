/**
 * When Acasă offers **Pornește notificările** (2026-10-06, Alex: "is there
 * any way in which i can set by default the notification as approved and
 * on?"). A browser grants the notification permission only to a tap, so the
 * app asks once, on the first screen, instead of leaving the switch deep in
 * Profil. Where the permission is already granted the app switches push on
 * by itself instead (`autoEnableDevice` in `push-device.ts`), so the card is
 * only for the permission nobody has answered yet.
 */

/** How long **Mai târziu** hides the card: a week, per Member and device. */
export const PUSH_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60_000;

function snoozeKey(memberId: string) {
  return `osubb.push-prompt-later.${memberId}`;
}

/** Whether the Member chose **Mai târziu** here less than a week ago. */
export function pushPromptSnoozed(
  memberId: string,
  now: number = Date.now(),
): boolean {
  try {
    const at = Number(localStorage.getItem(snoozeKey(memberId)));
    return at > 0 && now - at < PUSH_PROMPT_SNOOZE_MS;
  } catch {
    return false;
  }
}

/** **Mai târziu**: hide the card on this device for a week. */
export function snoozePushPrompt(memberId: string, now: number = Date.now()) {
  try {
    localStorage.setItem(snoozeKey(memberId), String(now));
  } catch {
    // Without storage the card comes back at the next visit; it is one tap.
  }
}

/**
 * An iPhone, iPod or iPad, where Web Push reaches only the app added to the
 * home screen. iPadOS asks for the desktop site by default and then calls
 * itself a Mac: the touch screen tells them apart (a Mac has none).
 */
export function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(agent)) return true;
  return /Macintosh/.test(agent) && navigator.maxTouchPoints > 1;
}

/** Whether the iPad, rather than an iPhone, for the card's wording. */
export function isIpad(): boolean {
  if (typeof navigator === 'undefined') return false;
  const agent = navigator.userAgent;
  return (
    /iPad/.test(agent) ||
    (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)
  );
}

/** Opened from the home screen (the installed app), not a browser tab. */
export function runsInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = (navigator as Navigator & { standalone?: boolean })
    .standalone;
  if (standalone === true) return true;
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  );
}

export type PushPromptKind = 'push' | 'install' | null;

/**
 * Which card Acasă shows, if any:
 * - `install` on an iPhone or iPad in a browser tab: push is impossible
 *   there, so the card shows how to add the app to the home screen;
 * - `push` where push works, the permission was never answered and this
 *   device is not subscribed;
 * - nothing without a VAPID key (no push in this build), after **Mai
 *   târziu** for a week, while the device is still being read, or once the
 *   permission is `granted` or `denied`.
 */
export function pushPromptKind(state: {
  configured: boolean;
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  loading: boolean;
  snoozed: boolean;
  appleMobile: boolean;
  installed: boolean;
}): PushPromptKind {
  if (!state.configured || state.snoozed) return null;
  if (state.appleMobile && !state.installed) return 'install';
  if (!state.supported || state.loading || state.subscribed) return null;
  return state.permission === 'default' ? 'push' : null;
}
