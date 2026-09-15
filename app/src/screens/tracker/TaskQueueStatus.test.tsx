import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const useTaskQueue = vi.hoisted(() => vi.fn());
vi.mock('../../queries/task-queue', () => ({ useTaskQueue }));
import { TaskQueueStatus } from './TaskQueueStatus';

describe('Own Candidate Queue', () => {
  it('updates positions and explicitly labels selected and closed states', () => {
    useTaskQueue.mockReturnValue({ data: { status: 'pending', position: 3 } });
    const { rerender } = render(<TaskQueueStatus taskId={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('Locul 3');
    useTaskQueue.mockReturnValue({ data: { status: 'pending', position: 2 } });
    rerender(<TaskQueueStatus taskId={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('Locul 2');
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
