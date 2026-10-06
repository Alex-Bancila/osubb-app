import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUSH_PROMPT_SNOOZE_MS } from '../../lib/push-prompt';
import type { usePushSubscription } from '../../queries/push-subscription';

type PushState = ReturnType<typeof usePushSubscription>;

const MEMBER = vi.hoisted(() => '33333333-3333-4333-8333-333333333333');
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: MEMBER } } }),
}));

const hook = vi.hoisted(() => ({
  state: null as unknown as PushState,
  enable: vi.fn(),
  disable: vi.fn(),
}));
vi.mock('../../queries/push-subscription', () => ({
  usePushSubscription: () => hook.state,
}));

import PushPromptCard, { PUSH_PROMPT_RECEIPT_MS } from './PushPromptCard';

const SNOOZE_KEY = `osubb.push-prompt-later.${MEMBER}`;
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
/* iPadOS asks for the desktop site by default and calls itself a Mac. */
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

function answer(overrides: Partial<PushState> = {}) {
  hook.state = {
    supported: true,
    configured: true,
    permission: 'default',
    subscribed: false,
    target: null,
    revoked: false,
    loading: false,
    pending: false,
    error: null,
    enable: hook.enable,
    disable: hook.disable,
    ...overrides,
  };
}

function device({
  agent = DESKTOP,
  touchPoints = 0,
  installed = false,
}: { agent?: string; touchPoints?: number; installed?: boolean } = {}) {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    get: () => agent,
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    get: () => touchPoints,
  });
  Object.defineProperty(navigator, 'standalone', {
    configurable: true,
    get: () => installed,
  });
}

function card() {
  return screen.queryByRole('region', { name: 'Pornește notificările' });
}

function installCard() {
  return screen.queryByRole('region', {
    name: 'Adaugă OSUBB pe ecranul principal',
  });
}

describe('PushPromptCard', () => {
  beforeEach(() => {
    hook.enable.mockClear();
    localStorage.clear();
    device();
    answer();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'userAgent');
    Reflect.deleteProperty(navigator, 'maxTouchPoints');
    Reflect.deleteProperty(navigator, 'standalone');
    vi.useRealTimers();
  });

  it('asks where push works, the permission is unanswered and the device is off', async () => {
    const { container } = render(<PushPromptCard />);

    const region = card();
    expect(region).not.toBeNull();
    expect(region).toHaveTextContent(
      'Află pe loc de Taskuri, Evenimente și Anunțuri noi, chiar cu aplicația închisă.',
    );
    expect(screen.getByRole('button', { name: 'Pornește' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Mai târziu' })).toBeEnabled();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it.each<[string, Partial<PushState>]>([
    ['an unsupported browser', { supported: false, permission: 'unsupported' }],
    ['a build without the VAPID key', { configured: false }],
    ['a granted permission', { permission: 'granted' }],
    ['a denied permission', { permission: 'denied' }],
    ['a subscribed device', { subscribed: true }],
    ['a device still being read', { loading: true }],
  ])('stays away for %s', (_, overrides) => {
    answer(overrides);
    const { container } = render(<PushPromptCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a tap runs the switch’s own enable, once', async () => {
    const user = userEvent.setup();
    render(<PushPromptCard />);

    await user.click(screen.getByRole('button', { name: 'Pornește' }));

    expect(hook.enable).toHaveBeenCalledTimes(1);
  });

  it('says it is starting while the change runs, and keeps both buttons still', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PushPromptCard />);
    await user.click(screen.getByRole('button', { name: 'Pornește' }));

    answer({ pending: true, target: true });
    rerender(<PushPromptCard />);

    expect(screen.getByRole('button', { name: 'Se pornesc…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mai târziu' })).toBeDisabled();
  });

  it('granted: a short receipt, then nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender, container } = render(<PushPromptCard />);
    await user.click(screen.getByRole('button', { name: 'Pornește' }));

    // The device read lags the answer: subscribed is still false.
    answer({ permission: 'granted' });
    rerender(<PushPromptCard />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Notificările sunt pornite pe acest dispozitiv.',
    );
    expect(screen.queryByRole('button')).toBeNull();

    answer({ permission: 'granted', subscribed: true });
    rerender(<PushPromptCard />);
    act(() => vi.advanceTimersByTime(PUSH_PROMPT_RECEIPT_MS));
    expect(container).toBeEmptyDOMElement();
  });

  it('blocked: one quiet line on how to allow it later, and no buttons', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PushPromptCard />);
    await user.click(screen.getByRole('button', { name: 'Pornește' }));

    answer({ permission: 'denied' });
    rerender(<PushPromptCard />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Notificările sunt blocate pe acest dispozitiv. Le poți permite din setările browserului, apoi le pornești din Profil.',
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(card()).toBeNull();
  });

  it('a prompt closed without an answer keeps the card', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PushPromptCard />);
    await user.click(screen.getByRole('button', { name: 'Pornește' }));

    answer({ permission: 'default' });
    rerender(<PushPromptCard />);

    expect(screen.getByRole('button', { name: 'Pornește' })).toBeEnabled();
  });

  it('a refusal is said on the card, which stays for another try', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PushPromptCard />);
    await user.click(screen.getByRole('button', { name: 'Pornește' }));

    answer({ permission: 'granted', error: 'Ai deja cinci dispozitive.' });
    rerender(<PushPromptCard />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Ai deja cinci dispozitive.',
    );
    expect(screen.getByRole('button', { name: 'Pornește' })).toBeEnabled();
  });

  it('Mai târziu hides it for a week on this device', async () => {
    const user = userEvent.setup();
    const { container } = render(<PushPromptCard />);

    await user.click(screen.getByRole('button', { name: 'Mai târziu' }));

    expect(container).toBeEmptyDOMElement();
    expect(Number(localStorage.getItem(SNOOZE_KEY))).toBeGreaterThan(0);
    expect(hook.enable).not.toHaveBeenCalled();
  });

  it('stays hidden within the week, and comes back after it', () => {
    localStorage.setItem(
      SNOOZE_KEY,
      String(Date.now() - PUSH_PROMPT_SNOOZE_MS + 60_000),
    );
    const first = render(<PushPromptCard />);
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();

    localStorage.setItem(
      SNOOZE_KEY,
      String(Date.now() - PUSH_PROMPT_SNOOZE_MS - 60_000),
    );
    render(<PushPromptCard />);
    expect(card()).not.toBeNull();
  });

  describe('iPhone and iPad', () => {
    it('in Safari, shows how to add the app to the home screen instead', async () => {
      device({ agent: IPHONE, touchPoints: 5 });
      // iOS Safari exposes no Push API outside the installed app.
      answer({ supported: false, permission: 'unsupported' });
      const { container } = render(<PushPromptCard />);

      const region = installCard();
      expect(region).not.toBeNull();
      expect(region).toHaveTextContent(
        'Pe iPhone, notificările despre Taskuri, Evenimente și Anunțuri ajung doar în aplicația deschisă de pe ecranul principal.',
      );
      // The number is the list's own order, hidden from assistive tech.
      const steps = screen.getAllByRole('listitem');
      expect(steps.map((step) => step.textContent)).toEqual([
        '1Atinge butonul de partajare  din Safari.',
        '2Alege Adaugă pe ecranul principal.',
        '3Deschide OSUBB de pe ecranul principal și pornește notificările.',
      ]);
      expect(screen.queryByRole('button', { name: 'Pornește' })).toBeNull();
      expect((await axe.run(container)).violations).toEqual([]);
    });

    it('names the iPad on an iPad that asks for the desktop site', () => {
      device({ agent: IPAD_AS_MAC, touchPoints: 5 });
      answer({ supported: false, permission: 'unsupported' });
      render(<PushPromptCard />);
      expect(installCard()).toHaveTextContent(/^.*Pe iPad, notificările/);
    });

    it('a Mac is not an iPad: no touch screen, no install steps', () => {
      device({ agent: IPAD_AS_MAC, touchPoints: 0 });
      render(<PushPromptCard />);
      expect(installCard()).toBeNull();
      expect(card()).not.toBeNull();
    });

    it('opened from the home screen, asks for push like anywhere else', () => {
      device({ agent: IPHONE, touchPoints: 5, installed: true });
      render(<PushPromptCard />);
      expect(installCard()).toBeNull();
      expect(card()).not.toBeNull();
    });

    it('follows the same week-long Mai târziu', async () => {
      device({ agent: IPHONE, touchPoints: 5 });
      answer({ supported: false, permission: 'unsupported' });
      const user = userEvent.setup();
      const { container, unmount } = render(<PushPromptCard />);

      await user.click(screen.getByRole('button', { name: 'Mai târziu' }));
      expect(container).toBeEmptyDOMElement();
      unmount();

      expect(render(<PushPromptCard />).container).toBeEmptyDOMElement();
    });

    it('says nothing in a build without push', () => {
      device({ agent: IPHONE, touchPoints: 5 });
      answer({
        supported: false,
        permission: 'unsupported',
        configured: false,
      });
      expect(render(<PushPromptCard />).container).toBeEmptyDOMElement();
    });
  });
});
