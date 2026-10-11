import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClipboardCheck, PlusIcon } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { FabAction, FabActions } from './Fab';

describe('FabActions', () => {
  it('turns its one action into the plus button, named after it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FabActions>
        <FabAction label="Eveniment nou" icon={PlusIcon} onSelect={onSelect} />
      </FabActions>,
    );

    const fab = screen.getByRole('button', { name: 'Eveniment nou' });
    expect(fab).toHaveAttribute('data-slot', 'fab');
    expect(fab).not.toHaveTextContent('Eveniment nou');
    await user.click(fab);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('opens a menu of its actions when there are several', async () => {
    const user = userEvent.setup();
    const onNew = vi.fn();
    const onCompleted = vi.fn();
    render(
      <FabActions>
        <FabAction label="Task nou" icon={PlusIcon} onSelect={onNew} />
        <FabAction
          label="Adaugă task finalizat"
          icon={ClipboardCheck}
          onSelect={onCompleted}
        />
      </FabActions>,
    );

    expect(screen.queryByRole('button', { name: 'Task nou' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Adaugă' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Task nou' }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('menuitem', { name: 'Adaugă task finalizat' }),
    );
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(onNew).not.toHaveBeenCalled();
  });

  it('draws no button for a viewer with nothing to create', () => {
    const { container } = render(
      <FabActions>
        <p>Conținut</p>
      </FabActions>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-slot="fab-spacer"]')).toBeNull();
  });

  it('drops an action whose control goes away', () => {
    const view = (show: boolean) => (
      <FabActions>
        {show && (
          <FabAction label="Anunț nou" icon={PlusIcon} onSelect={() => {}} />
        )}
      </FabActions>
    );
    const { rerender } = render(view(true));
    expect(screen.getByRole('button', { name: 'Anunț nou' })).toBeVisible();
    rerender(view(false));
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('FabAction outside FabActions', () => {
  it('is an ordinary labelled button', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<FabAction label="Deal nou" icon={PlusIcon} onSelect={onSelect} />);

    const button = screen.getByRole('button', { name: 'Deal nou' });
    expect(button).toHaveTextContent('Deal nou');
    expect(button).not.toHaveAttribute('data-slot', 'fab');
    await user.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
