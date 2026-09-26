import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

/* A two-table stand-in: the current version in org_settings and the
   Member's own acknowledgement rows, answered by `maybeSingle()`. */
const db = vi.hoisted(() => ({
  version: '1.0' as string | null,
  acknowledged: [] as string[],
  settingsError: null as Error | null,
  rpc: vi.fn(),
}));
vi.mock('../../lib/supabase', () => {
  function query(table: string) {
    const filters = new Map<string, unknown>();
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.set(column, value);
        return chain;
      },
      maybeSingle: async () => {
        if (table === 'org_settings')
          return db.settingsError
            ? { data: null, error: db.settingsError }
            : {
                data: db.version === null ? null : { value: db.version },
                error: null,
              };
        const version = filters.get('notice_version') as string;
        return {
          data: db.acknowledged.includes(version)
            ? { notice_version: version }
            : null,
          error: null,
        };
      },
    };
    return chain;
  }
  return { supabase: { from: query, rpc: db.rpc } };
});
vi.mock('../../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'member-1' } } }),
}));
import { PrivacyGate } from './PrivacyGate';

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PrivacyGate>
        <h1>Acasă</h1>
      </PrivacyGate>
    </QueryClientProvider>,
  );
}

const BUTTON = { name: 'Am citit și am înțeles' };

beforeEach(() => {
  db.version = '1.0';
  db.acknowledged = [];
  db.settingsError = null;
  db.rpc.mockReset();
});

it('shows the notice and nothing of the app to a Member who never acknowledged it', async () => {
  show();
  expect(await screen.findByRole('button', BUTTON)).toBeVisible();
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Politica de confidențialitate a aplicației OSUBB',
    }),
  ).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Acasă' })).toBeNull();
  // One button, and no way around it.
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.queryAllByRole('link')).toHaveLength(0);
});

it('asks again when the Member acknowledged only an older version', async () => {
  db.version = '1.1';
  db.acknowledged = ['1.0'];
  show();
  expect(await screen.findByRole('button', BUTTON)).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Acasă' })).toBeNull();
});

it('opens the app for a Member who acknowledged the current version', async () => {
  db.acknowledged = ['1.0'];
  show();
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();
  expect(screen.queryByRole('button', BUTTON)).toBeNull();
});

it('opens the app when no version is configured at all', async () => {
  db.version = null;
  show();
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();
});

it('records the current version on the tap, then opens the app', async () => {
  const user = userEvent.setup();
  db.rpc.mockImplementation(async () => {
    db.acknowledged = ['1.0'];
    return { data: {}, error: null };
  });
  show();
  await user.click(await screen.findByRole('button', BUTTON));
  expect(db.rpc).toHaveBeenCalledWith('acknowledge_privacy_notice', {
    p_version: '1.0',
  });
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();
});

it('treats an acknowledgement made in another tab as done', async () => {
  const user = userEvent.setup();
  db.rpc.mockImplementation(async () => {
    db.acknowledged = ['1.0'];
    return {
      data: null,
      error: { code: 'PT409', message: 'privacy_notice_already_acknowledged' },
    };
  });
  show();
  await user.click(await screen.findByRole('button', BUTTON));
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('explains a version that changed under the Member and asks for the new one', async () => {
  const user = userEvent.setup();
  db.rpc.mockImplementation(async () => {
    db.version = '1.1';
    return {
      data: null,
      error: { code: 'PT409', message: 'privacy_notice_version_stale' },
    };
  });
  show();
  await user.click(await screen.findByRole('button', BUTTON));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Politica de confidențialitate tocmai s-a actualizat.',
  );
  expect(screen.queryByRole('heading', { name: 'Acasă' })).toBeNull();

  db.rpc.mockImplementation(async () => {
    db.acknowledged = ['1.1'];
    return { data: {}, error: null };
  });
  await user.click(screen.getByRole('button', BUTTON));
  await waitFor(() =>
    expect(db.rpc).toHaveBeenLastCalledWith('acknowledge_privacy_notice', {
      p_version: '1.1',
    }),
  );
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();
});

it('does not let the Member past when the check cannot be read', async () => {
  const user = userEvent.setup();
  db.settingsError = new Error('offline');
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Verifică internetul',
  );
  expect(screen.queryByRole('heading', { name: 'Acasă' })).toBeNull();

  db.settingsError = null;
  db.acknowledged = ['1.0'];
  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }));
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();
});
