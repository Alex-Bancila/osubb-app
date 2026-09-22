import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ManagerTaskTable } from './ManagerTaskTable';
import { toTaskPresentation } from './task-presentation';
import { taskRow } from '../../test/task-fixtures';

const now = new Date('2026-09-15T12:00:00Z');
const tasks = [
  toTaskPresentation(
    taskRow({
      id: 1,
      title: 'Z urgent',
      deadline: '2026-09-14T10:00:00Z',
      status: 'in_progress',
      review_round: 1,
      campaign_id: 1,
      campaign: { name: 'Toamnă' },
    }),
    now,
  ),
  toTaskPresentation(
    taskRow({
      id: 2,
      title: 'A viitor',
      deadline: '2026-09-20T10:00:00Z',
      group_id: 30,
      group: {
        name: 'Gala',
        short: null,
        color: null,
        category: 'project',
        path: [30],
      },
    }),
    now,
  ),
];
const titles = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent);

describe('Manager Task filters', () => {
  it('keeps overdue rows first even when a user sorts by title', async () => {
    const user = userEvent.setup();
    render(<ManagerTaskTable tasks={tasks} />);
    expect(titles()).toEqual(['Z urgent', 'A viitor']);
    await user.click(
      screen.getByRole('button', { name: 'Sortează Task crescător' }),
    );
    expect(titles()).toEqual(['Z urgent', 'A viitor']);
  });
  it('combines Origin, Campaign, derived state, and title filters without widening rows', async () => {
    const user = userEvent.setup();
    render(<ManagerTaskTable tasks={tasks} />);
    await user.selectOptions(screen.getByLabelText('Campanie'), '1');
    await user.selectOptions(screen.getByLabelText('Stare'), 'feedback');
    await user.type(screen.getByRole('searchbox'), 'urgent');
    expect(titles()).toEqual(['Z urgent']);
    await user.selectOptions(screen.getByLabelText('Origine'), '30');
    expect(
      screen.getByText('Niciun task nu corespunde filtrelor.'),
    ).toBeVisible();
    expect(screen.queryByText('A viitor')).not.toBeInTheDocument();
  });
});
