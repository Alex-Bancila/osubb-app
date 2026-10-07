import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSupabaseMock, supabaseMock } from '../../test/supabase-mock';

vi.mock('../../lib/supabase', async () => {
  const { supabaseClientMock } = await vi.importActual<
    typeof import('../../test/supabase-mock')
  >('../../test/supabase-mock');
  return { supabase: supabaseClientMock };
});
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}));

import { DealCodeStub } from './DealCodeStub';

const deal = {
  id: 42,
  title: 'Reducere la Librăria X',
  code: 'OSUBB-2026',
  isRevealed: false,
};

function renderStub(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

beforeEach(() => {
  resetSupabaseMock();
  supabaseMock.rpc.mockResolvedValue({ data: 'OSUBB-2026', error: null });
});

describe('DealCodeStub (R45)', () => {
  it('hides the code behind one labelled button, with nothing of the code in the page', () => {
    const { container } = renderStub(<DealCodeStub deal={deal} />);
    const button = screen.getByRole('button', {
      name: 'Arată codul OSUBB pentru Reducere la Librăria X',
    });
    expect(button).toBeVisible();
    expect(screen.getByText('Cod OSUBB · atinge ca să-l vezi')).toBeVisible();
    expect(screen.getByText('Cod ascuns')).toBeVisible();
    // The blurred characters are a mask, never the code.
    expect(container.textContent).not.toContain('OSUBB-2026');
    expect(container.querySelector('.deal-code-mask')).not.toBeNull();
    expect(container.querySelector('[data-slot="deal-code"]')).toHaveAttribute(
      'data-state',
      'hidden',
    );
  });

  it('reveals on a tap: asks the server once, then shows the code, Copiază and the stamp', async () => {
    const user = userEvent.setup();
    const { container } = renderStub(<DealCodeStub deal={deal} />);
    await user.click(screen.getByRole('button', { name: /Arată codul/ }));

    expect(await screen.findByText('OSUBB-2026')).toBeVisible();
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('reveal_deal_code', {
      p_announcement_id: 42,
    });
    expect(screen.getByText('Dezvăluit')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copiază' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Arată codul/ })).toBeNull();
    expect(container.querySelector('[data-slot="deal-code"]')).toHaveAttribute(
      'data-state',
      'revealed',
    );
    // The keyboard stays on what it revealed.
    await waitFor(() =>
      expect(screen.getByLabelText('Codul: OSUBB-2026')).toHaveFocus(),
    );
  });

  it('copies the code and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderStub(<DealCodeStub deal={{ ...deal, isRevealed: true }} />);
    await user.click(screen.getByRole('button', { name: 'Copiază' }));
    expect(writeText).toHaveBeenCalledWith('OSUBB-2026');
    expect(await screen.findByRole('button', { name: 'Copiat' })).toBeVisible();
    expect(screen.getByText('Codul a fost copiat.')).toBeInTheDocument();
  });

  it('starts revealed when the server remembers the reveal, and never asks again', () => {
    renderStub(<DealCodeStub deal={{ ...deal, isRevealed: true }} />);
    expect(screen.getByText('OSUBB-2026')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Arată codul/ })).toBeNull();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('stays hidden and says so when the reveal fails', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PT404', message: 'announcement_not_found' },
    });
    const { container } = renderStub(<DealCodeStub deal={deal} />);
    await user.click(screen.getByRole('button', { name: /Arată codul/ }));
    expect(
      await screen.findByText('Nu am putut deschide codul. Încearcă din nou.'),
    ).toBeVisible();
    expect(container.textContent).not.toContain('OSUBB-2026');
  });

  it('renders nothing for a Deal without a code', () => {
    const { container } = renderStub(
      <DealCodeStub deal={{ ...deal, code: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
