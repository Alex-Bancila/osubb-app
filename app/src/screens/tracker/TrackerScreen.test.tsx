import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TrackerScreen from './TrackerScreen';
import { useMyTasks } from '../../queries/tasks';

// Mock dependencies
vi.mock('../../queries/tasks', () => ({
  useMyTasks: vi.fn(),
}));

// We'll mock the TaskGrid so it doesn't fail trying to load AG Grid in jsdom
vi.mock('../../components/TaskGrid', () => ({
  default: () => <div data-testid="mock-task-grid">Grid</div>
}));

describe('TrackerScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    vi.mocked(useMyTasks).mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
      refetch: vi.fn(),
    } as any);

    render(<TrackerScreen />);
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
  });

  it('renders error state and handles refetch', () => {
    const refetchMock = vi.fn();
    vi.mocked(useMyTasks).mockReturnValue({
      data: undefined,
      error: new Error('Network error'),
      isLoading: false,
      refetch: refetchMock,
    } as any);

    render(<TrackerScreen />);
    expect(screen.getByTestId('error-state')).toBeInTheDocument();
    expect(screen.getByText('A apărut o eroare la încărcarea taskurilor.')).toBeInTheDocument();

    const retryButton = screen.getByText('Reîncearcă');
    fireEvent.click(retryButton);
    expect(refetchMock).toHaveBeenCalled();
  });

  it('renders empty state when there are no tasks', () => {
    vi.mocked(useMyTasks).mockReturnValue({
      data: [],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    render(<TrackerScreen />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('Nu ai niciun task asignat.')).toBeInTheDocument();
  });

  it('renders success state with tasks', async () => {
    vi.mocked(useMyTasks).mockReturnValue({
      data: [
        {
          id: 1,
          title: 'Test Task',
          status: 'todo',
          type: 'remote',
          difficulty: 1,
          rating: null,
          points: null,
          deadline: '2026-10-01',
          dept_id: 'it',
          team_id: null,
        }
      ],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    render(<TrackerScreen />);
    
    // Test the success state container renders
    expect(screen.getByTestId('success-state')).toBeInTheDocument();
    
    // TaskCard should be rendered (we check for the title)
    expect(screen.getByText('Test Task')).toBeInTheDocument();
  });
});
