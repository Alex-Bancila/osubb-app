import { StrictMode, type ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClipboardCheck, PlusIcon } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FabAction, FabActions } from './Fab';
import { FabSlotContext } from './fab-context';

describe('FabActions', () => {
  it('turns its one action into the plus button, named after it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FabActions>
        <FabAction label="Eveniment nou" icon={PlusIcon} onSelect={onSelect} />
      </FabActions>,
    );

    const fab = screen.getByRole('button', { name: 'Eveniment nou' });
    expect(fab).toHaveAttribute('data-slot', 'fab');
    expect(fab).not.toHaveTextContent('Eveniment nou');
    await user.click(fab);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('opens a menu of its actions when there are several', async () => {
    const user = userEvent.setup();
    const onNew = vi.fn();
    const onCompleted = vi.fn();
    render(
      <FabActions>
        <FabAction label="Task nou" icon={PlusIcon} onSelect={onNew} />
        <FabAction
          label="Adaugă task finalizat"
          icon={ClipboardCheck}
          onSelect={onCompleted}
        />
      </FabActions>,
    );

    expect(screen.queryByRole('button', { name: 'Task nou' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Adaugă' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Task nou' }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('menuitem', { name: 'Adaugă task finalizat' }),
    );
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(onNew).not.toHaveBeenCalled();
  });

  it('draws no button for a viewer with nothing to create', () => {
    const { container } = render(
      <FabActions>
        <p>Conținut</p>
      </FabActions>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-slot="fab-spacer"]')).toBeNull();
  });

  it('drops an action whose control goes away', () => {
    const view = (show: boolean) => (
      <FabActions>
        {show && (
          <FabAction label="Anunț nou" icon={PlusIcon} onSelect={() => {}} />
        )}
      </FabActions>
    );
    const { rerender } = render(view(true));
    expect(screen.getByRole('button', { name: 'Anunț nou' })).toBeVisible();
    rerender(view(false));
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('FabAction outside FabActions', () => {
  it('is an ordinary labelled button', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<FabAction label="Deal nou" icon={PlusIcon} onSelect={onSelect} />);

    const button = screen.getByRole('button', { name: 'Deal nou' });
    expect(button).toHaveTextContent('Deal nou');
    expect(button).not.toHaveAttribute('data-slot', 'fab');
    await user.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

// Option 1 of five, "Pop" (Alex, 2026-10-14): in over 360 ms with a small
// overshoot while the plus turns a quarter, out in 160 ms. jsdom has neither
// matchMedia nor Web Animations, so each test says what the browser allows.
describe('FabActions motion', () => {
  let finish: () => void = () => {};

  function allowMotion(allowed = true) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: allowed && query.includes('no-preference'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const animate = vi.fn(
      (_keyframes: Keyframe[], _options?: KeyframeAnimationOptions) => ({
        finished: new Promise<void>((resolve) => {
          finish = resolve;
        }),
        cancel: vi.fn(),
      }),
    );
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    });
    return animate;
  }

  function slotted(children: ReactNode) {
    const slot = document.createElement('div');
    document.body.append(slot);
    return {
      slot,
      ui: (
        <FabSlotContext.Provider value={slot}>
          <FabActions>{children}</FabActions>
        </FabSlotContext.Provider>
      ),
    };
  }

  const action = (
    <FabAction label="Anunț nou" icon={PlusIcon} onSelect={() => {}} />
  );

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(Element.prototype, 'animate');
    document.body.replaceChildren();
  });

  it('pops the button in while its plus turns a quarter', () => {
    const animate = allowMotion();
    const { ui } = slotted(action);
    render(ui);

    const fab = screen.getByRole('button', { name: 'Anunț nou' });
    const presence = fab.closest('[data-slot="fab-presence"]');
    expect(presence).not.toBeNull();
    const calls = animate.mock.calls.map((call, index) => ({
      on: animate.mock.contexts[index],
      keyframes: call[0] as unknown as Keyframe[],
      options: call[1] as unknown as KeyframeAnimationOptions,
    }));
    const pop = calls.find((call) => call.on === presence);
    expect(pop?.keyframes[0]).toMatchObject({ opacity: 0, scale: 0.55 });
    expect(pop?.options.duration).toBe(360);
    const turn = calls.find((call) => call.on === fab.querySelector('svg'));
    expect(turn?.keyframes[0]).toMatchObject({ rotate: '-90deg' });
  });

  it('leaves an inert copy that pops out when the button goes away', async () => {
    const animate = allowMotion();
    const { slot, ui } = slotted(action);
    const { unmount } = render(ui);
    unmount();

    const ghost = await waitFor(() => {
      const found = slot.querySelector<HTMLElement>('[data-slot="fab-ghost"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(ghost).toHaveAttribute('aria-hidden', 'true');
    expect(ghost.inert).toBe(true);
    expect(ghost.querySelector('[id]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    const out = animate.mock.calls.find(
      (_, index) => animate.mock.contexts[index] === ghost,
    );
    expect(out?.[0]).toEqual([
      { opacity: 1, scale: 1 },
      { opacity: 0, scale: 0.7 },
    ]);
    expect(out?.[1]).toMatchObject({ duration: 160, fill: 'forwards' });

    finish();
    await waitFor(() =>
      expect(slot.querySelector('[data-slot="fab-ghost"]')).toBeNull(),
    );
  });

  it('leaves no copy when React re-attaches the same button at once', async () => {
    allowMotion();
    const { slot, ui } = slotted(action);
    render(<StrictMode>{ui}</StrictMode>);

    await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Anunț nou' })).toBeVisible();
    expect(slot.querySelector('[data-slot="fab-ghost"]')).toBeNull();
  });

  it('moves nothing under reduced motion', async () => {
    const animate = allowMotion(false);
    const { slot, ui } = slotted(action);
    const { unmount } = render(ui);
    unmount();

    await Promise.resolve();
    expect(animate).not.toHaveBeenCalled();
    expect(slot.querySelector('[data-slot="fab-ghost"]')).toBeNull();
  });
});
