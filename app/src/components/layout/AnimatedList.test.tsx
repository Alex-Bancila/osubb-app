import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimatedList } from './AnimatedList';

function List({ items }: { items: string[] }) {
  return (
    <AnimatedList items={items} getKey={(item) => item} aria-label="Rânduri">
      {(item) => <span>{item}</span>}
    </AnimatedList>
  );
}

function allowMotion() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  const animations: { onfinish?: () => void }[] = [];
  Element.prototype.animate = vi.fn(() => {
    const animation = {};
    animations.push(animation);
    return animation;
  }) as unknown as typeof Element.prototype.animate;
  return animations;
}

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error jsdom has no Web Animations; the test adds and removes it.
  delete Element.prototype.animate;
});

describe('AnimatedList', () => {
  it('drops a row at once when motion is not allowed', () => {
    const { rerender } = render(<List items={['a', 'b', 'c']} />);
    rerender(<List items={['a', 'c']} />);
    expect(screen.queryByText('b')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('keeps a row that left as an inert copy in its place until it has closed', () => {
    const animations = allowMotion();
    const { rerender } = render(<List items={['a', 'b', 'c']} />);
    rerender(<List items={['a', 'c']} />);

    const leaving = screen.getByText('b').closest('li') as HTMLLIElement;
    expect(leaving).toHaveAttribute('data-leaving');
    expect(leaving).toHaveAttribute('aria-hidden', 'true');
    expect(leaving).toHaveAttribute('inert');
    expect(leaving.previousElementSibling).toHaveTextContent('a');
    expect(leaving.nextElementSibling).toHaveTextContent('c');
    // Only the two live rows are in the list for a screen reader.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    expect(animations).toHaveLength(1);
    act(() => animations[0]?.onfinish?.());
    expect(screen.queryByText('b')).not.toBeInTheDocument();
  });

  it('shows a row that comes back while its copy is still closing once', () => {
    allowMotion();
    const { rerender } = render(<List items={['a', 'b']} />);
    rerender(<List items={['a']} />);
    rerender(<List items={['a', 'b']} />);
    expect(screen.getAllByText('b')).toHaveLength(1);
    expect(screen.getByText('b').closest('li')).not.toHaveAttribute(
      'data-leaving',
    );
  });

  it('treats a replaced list as a new list', () => {
    allowMotion();
    const many = Array.from({ length: 10 }, (_, index) => `r${index}`);
    const { rerender } = render(<List items={many} />);
    rerender(<List items={['x']} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('r0')).not.toBeInTheDocument();
  });
});
