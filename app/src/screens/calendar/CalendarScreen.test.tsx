import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CalendarScreen from './CalendarScreen';
import { useUpcomingEvents } from '../../queries/events';

// Mock dependencies
vi.mock('../../queries/events', () => ({
  useUpcomingEvents: vi.fn(),
}));

describe('CalendarScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state', () => {
    vi.mocked(useUpcomingEvents).mockReturnValue({
      data: undefined,
      error: null,
      isLoading: true,
      refetch: vi.fn(),
    } as any);

    render(<CalendarScreen />);
    expect(screen.getByTestId('loading-state')).toBeInTheDocument();
  });

  it('renders error state and handles refetch', () => {
    const refetchMock = vi.fn();
    vi.mocked(useUpcomingEvents).mockReturnValue({
      data: undefined,
      error: new Error('Network error'),
      isLoading: false,
      refetch: refetchMock,
    } as any);

    render(<CalendarScreen />);
    expect(screen.getByTestId('error-state')).toBeInTheDocument();
    expect(screen.getByText('A apărut o eroare la încărcarea calendarului.')).toBeInTheDocument();

    const retryButton = screen.getByText('Reîncearcă');
    fireEvent.click(retryButton);
    expect(refetchMock).toHaveBeenCalled();
  });

  it('renders empty state when there are no events', () => {
    vi.mocked(useUpcomingEvents).mockReturnValue({
      data: [],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    render(<CalendarScreen />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('Nu există niciun eveniment programat.')).toBeInTheDocument();
  });

  it('renders success state with grouped events', () => {
    vi.mocked(useUpcomingEvents).mockReturnValue({
      data: [
        {
          id: 1,
          title: 'Ședință PR',
          type: 'sedinta',
          scope: 'dept',
          capacity: null,
          description: null,
          location: 'Sediul OSUBB',
          starts_at: '2026-09-15T18:00:00Z',
          ends_at: '2026-09-15T20:00:00Z',
          dept_id: 'pr',
          team_id: null,
          created_by: null,
          has_qr: false,
        }
      ],
      error: null,
      isLoading: false,
      refetch: vi.fn(),
    } as any);

    render(<CalendarScreen />);
    
    // Test the success state container renders
    expect(screen.getByTestId('success-state')).toBeInTheDocument();
    
    // Event title should be rendered
    expect(screen.getByText('Ședință PR')).toBeInTheDocument();
  });
});
