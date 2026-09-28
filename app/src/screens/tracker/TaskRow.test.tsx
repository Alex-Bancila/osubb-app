import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock(
  '../../queries/member-card',
  () => import('../../test/member-card-mock'),
);
vi.mock('../../lib/capabilities', () => ({
  useCapability: () => ({ data: false }),
}));
import { taskRow } from '../../test/task-fixtures';
import {
  toTaskPresentation,
  type TaskPresentationRow,
} from './task-presentation';
import { TaskRow } from './TaskRow';

function renderRow(
  overrides: Partial<TaskPresentationRow> = {},
  onOpenTask = vi.fn(),
) {
  const task = toTaskPresentation(
    taskRow({
      title: 'Logistică Tabăra de Toamnă',
      status: 'completed',
      completed_at: '2026-09-08T10:00:00Z',
      deadline: '2026-09-08T20:59:00Z',
      evaluations: [
        { id: 1, difficulty: 3, rating: 5, points: 15, reversed_at: null },
      ],
      visibleExecutor: {
        memberId: 'maria',
        fullName: 'Maria Dobre',
        nickname: null,
      },
      ...overrides,
    }),
    new Date('2026-09-28T12:00:00Z'),
  );
  render(<TaskRow task={task} onOpenTask={onOpenTask} />);
  return { onOpenTask, row: screen.getByRole('article') };
}

describe('TaskRow (#846, layout T1)', () => {
  it('is a ListRow: the title and the points on top, one meta line under both', () => {
    const { row } = renderRow();
    expect(row).toHaveAccessibleName('Logistică Tabăra de Toamnă');
    const listRow = row.querySelector('[data-slot="list-row"]');
    expect(listRow).not.toBeNull();
    const body = row.querySelector('[data-slot="list-row-body"]');
    expect(body).toHaveTextContent(/^Logistică Tabăra de Toamnă$/);
    // The title wraps by word and keeps a readable width (never ≈ 30 px).
    expect(body?.querySelector('h2')).toHaveClass(
      'min-w-48',
      'wrap-break-word',
    );
    expect(body?.querySelector('h2')).not.toHaveClass('wrap-anywhere');
    expect(row.querySelector('[data-slot="list-row-value"]')).toHaveTextContent(
      '15puncte',
    );
    // One meta line, spanning the row: Group, status, deadline, Executor.
    const footer = row.querySelector('[data-slot="list-row-footer"]');
    const meta = within(footer as HTMLElement);
    expect(
      footer?.querySelectorAll('[data-slot="task-row-meta"]'),
    ).toHaveLength(1);
    expect(meta.getByText('Finalizat')).toBeVisible();
    expect(meta.getByText(/8 septembrie 2026/)).toBeVisible();
    expect(meta.getByText('Executor:')).toBeVisible();
    expect(
      meta.getByRole('button', { name: 'Profilul membrului Maria Dobre' }),
    ).toBeVisible();
  });

  it('is one button for the Task, named by its title, stretched over the row', async () => {
    const user = userEvent.setup();
    const { onOpenTask, row } = renderRow();
    const open = within(row).getByRole('button', {
      name: 'Logistică Tabăra de Toamnă',
    });
    expect(open).toHaveClass('after:absolute', 'after:inset-0');
    // The only other button is the Executor's Member Card, above that area.
    expect(within(row).getAllByRole('button')).toHaveLength(2);
    expect(
      within(row).getByRole('button', {
        name: 'Profilul membrului Maria Dobre',
      }),
    ).toHaveClass('relative', 'z-10');
    await user.click(open);
    expect(onOpenTask).toHaveBeenCalledWith(1);
  });

  it('uses the kit’s box radius and shows the ring on the row when its button has focus', () => {
    const { row } = renderRow();
    expect(row).toHaveClass('rounded-md');
    expect(row).not.toHaveClass('rounded-lg');
    expect(row.className).toContain(
      'has-[[data-slot=task-row-open]:focus-visible]:outline-2',
    );
  });

  it('has no value column when the Task has no points yet', () => {
    const { row } = renderRow({ status: 'todo', evaluations: [] });
    expect(row.querySelector('[data-slot="list-row-value"]')).toBeNull();
    expect(within(row).getByText('Executor:')).toBeVisible();
  });
});
