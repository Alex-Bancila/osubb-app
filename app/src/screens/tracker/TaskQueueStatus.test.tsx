import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const useTaskQueue = vi.hoisted(() => vi.fn());
vi.mock('../../queries/task-queue', () => ({ useTaskQueue }));
import { toTaskPresentation } from './task-presentation';
import { taskRow } from '../../test/task-fixtures';
import { TaskQueueStatus } from './TaskQueueStatus';

describe('Own Candidate Queue', () => {
  it('uses participation in the current-stage summary', () => {
    useTaskQueue.mockReturnValue({ data: { status: 'pending', position: 3 } });
    render(
      <TaskQueueStatus
        taskId={1}
        task={toTaskPresentation(taskRow(), new Date('2026-09-01'))}
      />,
    );
    expect(
      screen.getByText('Ești pe locul 3 în lista de așteptare.'),
    ).toBeVisible();
    expect(screen.queryByText('Taskul este de făcut.')).not.toBeInTheDocument();
  });
  it('updates positions and explicitly labels selected and closed states', () => {
    useTaskQueue.mockReturnValue({ data: { status: 'pending', position: 3 } });
    const { rerender } = render(<TaskQueueStatus taskId={1} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Te-ai înscris pe locul 3.',
    );
    useTaskQueue.mockReturnValue({ data: { status: 'pending', position: 2 } });
    rerender(<TaskQueueStatus taskId={1} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Te-ai înscris pe locul 2.',
    );
    useTaskQueue.mockReturnValue({
      data: { status: 'selected', position: null },
    });
    rerender(<TaskQueueStatus taskId={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('Ai fost selectat');
    useTaskQueue.mockReturnValue({
      data: { status: 'closed', position: null },
    });
    rerender(<TaskQueueStatus taskId={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('Înscriere închisă');
  });
});
