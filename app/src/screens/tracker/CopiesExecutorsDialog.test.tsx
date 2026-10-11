import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('./DirectExecutorSelector', () => ({
  DirectExecutorSelector: ({
    label,
    value,
    excludeIds,
    onChange,
  }: {
    label: string;
    value: string | null;
    excludeIds?: readonly string[];
    onChange: (id: string | null) => void;
  }) => (
    <div data-testid="picker" data-excluded={(excludeIds ?? []).join(',')}>
      <span>{label}</span>
      <button type="button" onClick={() => onChange(`${label}-ales`)}>
        {value ? `${label}: ${value}` : `Alege pentru ${label}`}
      </button>
    </div>
  ),
}));
import { CopiesExecutorsDialog } from './CopiesExecutorsDialog';

function renderDialog(
  overrides: Partial<Parameters<typeof CopiesExecutorsDialog>[0]> = {},
) {
  const props = {
    count: 3,
    originGroupId: 4,
    plural: 'taskuri' as const,
    busy: false,
    error: null,
    onBack: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  render(<CopiesExecutorsDialog {...props} />);
  return { ...props, user: userEvent.setup() };
}

describe('the executors of n Tasks', () => {
  it('asks for one Executor per copy, titled by the count', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', {
      name: 'Executorii celor 3 taskuri',
    });
    expect(dialog).toHaveAccessibleDescription(
      'Alege câte un executor pentru fiecare exemplar.',
    );
    expect(screen.getAllByTestId('picker')).toHaveLength(3);
    expect(within(dialog).getByText('Exemplarul 1')).toBeVisible();
    expect(within(dialog).getByText('Exemplarul 3')).toBeVisible();
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(expect.arrayContaining(['Înapoi', 'Creează 3 taskuri']));
  });

  it('keeps a chosen Member out of the other pickers', async () => {
    const { user } = renderDialog({ count: 2 });
    await user.click(
      screen.getByRole('button', { name: 'Alege pentru Exemplarul 1' }),
    );
    const [first, second] = screen.getAllByTestId('picker');
    expect(first).toHaveAttribute('data-excluded', '');
    expect(second).toHaveAttribute('data-excluded', 'Exemplarul 1-ales');
  });

  it('refuses to create until every copy has an Executor, then confirms with the list', async () => {
    const { user, onConfirm } = renderDialog({ count: 2 });
    await user.click(screen.getByRole('button', { name: 'Creează 2 taskuri' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Alege câte un executor pentru fiecare exemplar.',
    );
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Alege pentru Exemplarul 1' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Alege pentru Exemplarul 2' }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Creează 2 taskuri' }));
    expect(onConfirm).toHaveBeenCalledWith([
      'Exemplarul 1-ales',
      'Exemplarul 2-ales',
    ]);
  });

  it("shows the server's refusal and goes back on Înapoi or Escape", async () => {
    const { user, onBack } = renderDialog({
      error: 'Executorul nu mai este eligibil.',
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Executorul nu mai este eligibil.',
    );
    await user.click(screen.getByRole('button', { name: 'Înapoi' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('is full screen on a phone and disables its buttons while busy', () => {
    renderDialog({ busy: true });
    expect(screen.getByRole('dialog').className).toContain(
      'max-sm:h-(--visible-height)',
    );
    expect(screen.getByRole('button', { name: 'Înapoi' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Se creează…' })).toBeDisabled();
  });
});
