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

import { keys } from '../../queries/keys';
import { DealCodeStub } from './DealCodeStub';

// #1152: the Deal row says only whether there is a code; the code itself is
// the answer of reveal_deal_code, which records the reveal.
const deal = {
  id: 42,
  title: 'Reducere la Librăria X',
  hasCode: true,
  isRevealed: false,
};

function renderStub(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
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
    expect(button).toHaveTextContent('Cod OSUBB · atinge ca să-l vezi');
    expect(screen.getByText('Cod ascuns')).toBeVisible();
    // The blurred characters are a mask, never the code.
    expect(container.textContent).not.toContain('OSUBB-2026');
    expect(container.querySelector('.deal-code-mask')).not.toBeNull();
    expect(container.querySelector('[data-slot="deal-code"]')).toHaveAttribute(
      'data-state',
      'hidden',
    );
    // A hidden code is never fetched: nothing reaches the page before a tap.
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('reveals on a tap through reveal_deal_code and shows the code it answered (#1152)', async () => {
    const user = userEvent.setup();
    const { client, container } = renderStub(<DealCodeStub deal={deal} />);
    await user.click(screen.getByRole('button', { name: /Arată codul/ }));

    expect(await screen.findByText('OSUBB-2026')).toBeVisible();
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('reveal_deal_code', {
      p_announcement_id: 42,
    });
    // The answer is kept in the query cache, where the stub reads it.
    expect(client.getQueryData(keys.announcements.dealCode(42, 'me'))).toBe(
      'OSUBB-2026',
    );
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
    await user.click(await screen.findByRole('button', { name: 'Copiază' }));
    expect(writeText).toHaveBeenCalledWith('OSUBB-2026');
    expect(await screen.findByRole('button', { name: 'Copiat' })).toBeVisible();
    expect(screen.getByText('Codul a fost copiat.')).toBeInTheDocument();
  });

  it('starts revealed when the server remembers the reveal, asking the same command once for the code', async () => {
    renderStub(<DealCodeStub deal={{ ...deal, isRevealed: true }} />);
    expect(await screen.findByText('OSUBB-2026')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Arată codul/ })).toBeNull();
    // reveal_deal_code is idempotent: a remembered reveal adds no reveal row.
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('reveal_deal_code', {
      p_announcement_id: 42,
    });
  });

  it('stays hidden and says so when the reveal fails', async () => {
    const user = userEvent.setup();
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PT404', message: 'deal_not_found' },
    });
    const { container } = renderStub(<DealCodeStub deal={deal} />);
    await user.click(screen.getByRole('button', { name: /Arată codul/ }));
    expect(
      await screen.findByText('Nu am putut deschide codul. Încearcă din nou.'),
    ).toBeVisible();
    expect(container.textContent).not.toContain('OSUBB-2026');
    expect(
      screen.getByRole('button', { name: /Arată codul/ }),
    ).not.toBeDisabled();
  });

  it('renders nothing for a Deal without a code, and asks nothing', () => {
    const { container } = renderStub(
      <DealCodeStub deal={{ ...deal, hasCode: false }} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });
});
