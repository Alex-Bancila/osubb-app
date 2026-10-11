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

  it('with repeats allowed, excludes nothing and reads the given title, description and labels (Part E)', async () => {
    const { user, onConfirm } = renderDialog({
      count: 2,
      allowRepeats: true,
      title: 'Voluntarii celor 2 taskuri finalizate',
      description: 'Alege câte un voluntar pentru fiecare exemplar.',
      confirmLabel: 'Adaugă 2 taskuri și acordă punctele',
      busyLabel: 'Se salvează…',
    });
    const dialog = screen.getByRole('dialog', {
      name: 'Voluntarii celor 2 taskuri finalizate',
    });
    expect(dialog).toHaveAccessibleDescription(
      'Alege câte un voluntar pentru fiecare exemplar.',
    );
    // Nothing chosen yet: the description doubles as the "all required" line.
    await user.click(
      screen.getByRole('button', {
        name: 'Adaugă 2 taskuri și acordă punctele',
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Alege câte un voluntar pentru fiecare exemplar.',
    );
    await user.click(
      screen.getByRole('button', { name: 'Alege pentru Exemplarul 1' }),
    );
    const [, second] = screen.getAllByTestId('picker');
    expect(second).toHaveAttribute('data-excluded', '');
    await user.click(
      screen.getByRole('button', { name: 'Alege pentru Exemplarul 2' }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Adaugă 2 taskuri și acordă punctele',
      }),
    );
    expect(onConfirm).toHaveBeenCalledWith([
      'Exemplarul 1-ales',
      'Exemplarul 2-ales',
    ]);
  });

  it('draws the picker its caller hands it, one per copy, with that copy’s slot', async () => {
    const { user, onConfirm } = renderDialog({
      count: 2,
      renderPicker: ({ index, value, onChange }) => (
        <button
          type="button"
          data-testid="custom"
          onClick={() => onChange(`v${index + 1}`)}
        >
          {value ?? `Voluntar ${index + 1}`}
        </button>
      ),
    });
    expect(screen.queryAllByTestId('picker')).toHaveLength(0);
    const custom = screen.getAllByTestId('custom');
    expect(custom.map((node) => node.textContent)).toEqual([
      'Voluntar 1',
      'Voluntar 2',
    ]);
    await user.click(screen.getByRole('button', { name: 'Voluntar 1' }));
    await user.click(screen.getByRole('button', { name: 'Voluntar 2' }));
    await user.click(screen.getByRole('button', { name: 'Creează 2 taskuri' }));
    expect(onConfirm).toHaveBeenCalledWith(['v1', 'v2']);
  });
});
