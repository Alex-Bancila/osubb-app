import { render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';
import { ListRow, rowListClass } from './ListRow';
import { Empty, ErrorState, Loading } from '../states';

describe('ListRow', () => {
  it('is 56 px tall with leading · body · value · action columns', () => {
    render(
      <ul className={rowListClass} aria-label="Clasament">
        <ListRow
          leading="1"
          value="120"
          action={<button type="button">Deschide</button>}
        >
          Ana
        </ListRow>
      </ul>,
    );
    const row = screen.getByRole('listitem');
    expect(row).toHaveClass(
      'grid',
      'min-h-14',
      'px-3',
      'py-2',
      'gap-3',
      'grid-cols-[2.5rem_minmax(0,1fr)_auto_auto]',
    );
    expect(screen.getByText('120')).toHaveClass('tabular-nums', 'text-right');
    expect(screen.getByRole('list')).toHaveClass(
      'divide-y',
      'divide-(--border-soft)',
    );
  });

  it("marks the viewer's own row", () => {
    render(
      <ul>
        <ListRow mine>Eu</ListRow>
        <ListRow>Altcineva</ListRow>
      </ul>,
    );
    const [mine, other] = screen.getAllByRole('listitem');
    expect(mine).toHaveClass('bg-primary/5', 'ring-1', 'ring-primary/30');
    expect(other).not.toHaveClass('bg-primary/5');
  });

  it('has no column for an absent cell, and can stack its action on phones', () => {
    render(
      <ul>
        <ListRow
          stackAction
          action={<button type="button">Redenumește</button>}
        >
          Campanie
        </ListRow>
      </ul>,
    );
    expect(screen.getByRole('listitem')).toHaveClass(
      'grid-cols-[minmax(0,1fr)_auto]',
    );
    expect(
      screen.getByRole('button').closest('[data-slot="list-row-action"]'),
    ).toHaveClass('max-sm:col-span-full');
  });
});

describe('EmptyState', () => {
  it('says what would be here, centred, with no border inside a box', () => {
    render(<EmptyState>Nu ai niciun task atribuit încă.</EmptyState>);
    const state = screen
      .getByText('Nu ai niciun task atribuit încă.')
      .closest('[data-slot="empty-state"]');
    expect(state).toHaveClass('py-8', 'items-center', 'text-center');
    expect(state).not.toHaveClass('border-dashed');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('on its own gets a dashed border, an icon and one action', () => {
    const { container } = render(
      <EmptyState
        bare
        icon={Inbox}
        action={<button type="button">Șterge filtrele</button>}
      >
        Niciun membru nu corespunde filtrelor.
      </EmptyState>,
    );
    expect(container.querySelector('[data-slot="empty-state"]')).toHaveClass(
      'border-dashed',
    );
    expect(container.querySelector('svg')).toHaveClass('size-5');
    expect(
      screen.getByRole('button', { name: 'Șterge filtrele' }),
    ).toBeInTheDocument();
  });

  it('shares its height with Loading and ErrorState', () => {
    render(
      <>
        <Loading />
        <ErrorState text="Nu am putut încărca." />
        <Empty text="Nimic aici." />
      </>,
    );
    expect(screen.getByRole('status')).toHaveClass('py-8');
    expect(screen.getByRole('alert')).toHaveClass('py-8');
    expect(
      screen.getByText('Nimic aici.').closest('[data-slot="empty-state"]'),
    ).toHaveClass('py-8');
  });
});
