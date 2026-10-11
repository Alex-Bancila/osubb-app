import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './toast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Toast', () => {
  it('announces the receipt off the page, without taking focus', () => {
    const { container } = render(
      <Toast onClose={() => {}}>Anunțul a fost publicat.</Toast>,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Anunțul a fost publicat.');
    // Floating over the page, not a row in it.
    expect(container).toBeEmptyDOMElement();
    expect(status.closest('[data-slot="toast"]')).toHaveClass('fixed');
    expect(document.body).toHaveFocus();
  });

  it('closes itself after four seconds', () => {
    const onClose = vi.fn();
    render(<Toast onClose={onClose}>Gata.</Toast>);
    act(() => vi.advanceTimersByTime(3900));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(400));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
