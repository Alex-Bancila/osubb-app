import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalendarDays, ListIcon } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedToggle } from './SegmentedToggle';

const options = [
  { value: 'month', label: 'Lună', icon: CalendarDays },
  { value: 'agenda', label: 'Agendă', icon: ListIcon },
] as const;

describe('SegmentedToggle', () => {
  it('is a labelled group whose chosen segment is aria-pressed', () => {
    render(
      <SegmentedToggle
        label="Vizualizare"
        options={options}
        value="agenda"
        onChange={() => {}}
      />,
    );
    const group = screen.getByRole('group', { name: 'Vizualizare' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agendă' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Lună' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // 44 px in all (X5): 36 px segments in a 3 px track with a 1 px
    // border; each segment's hit area reaches the track's edge.
    expect(group).toHaveClass('p-[3px]', 'border');
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass(
        'min-h-[36px]',
        'min-w-11',
        'after:-inset-y-1',
      );
      expect(button).not.toHaveClass('min-h-11');
      // A visible focus ring (X1): the style is named, not left to outline-none.
      expect(button).toHaveClass(
        'focus-visible:outline-2',
        'focus-visible:outline-solid',
      );
    }
  });

  it('calls back with the chosen value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedToggle
        label="Vizualizare"
        options={options}
        value="month"
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Agendă' }));
    expect(onChange).toHaveBeenCalledWith('agenda');
  });
});
