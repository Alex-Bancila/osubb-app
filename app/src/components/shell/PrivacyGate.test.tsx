import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

/* A two-table stand-in: the current version in org_settings and the
   Member's own acknowledgement rows, answered by `maybeSingle()`. */
const db = vi.hoisted(() => ({
  version: '1.1' as string | null,
  acknowledged: [] as string[],
  settingsError: null as Error | null,
  settingsReads: 0,
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
        if (table === 'org_settings') db.settingsReads += 1;
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
const reloadToLatestVersion = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../pwa/reload-to-latest', () => ({ reloadToLatestVersion }));
import { PRIVACY_NOTICE_VERSION } from '../../screens/privacy/PrivacyNoticeContent';
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

const NEW_VERSION = {
  name: 'A apărut o versiune nouă a aplicației',
  level: 1,
} as const;

beforeEach(() => {
  db.version = '1.1';
  db.acknowledged = [];
  db.settingsError = null;
  db.settingsReads = 0;
  db.rpc.mockReset();
  reloadToLatestVersion.mockClear();
});

it('bundles the 1.1 notice (#860), the version the migration sets', () => {
  expect(PRIVACY_NOTICE_VERSION).toBe('1.1');
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
  // One button, and no way around it: the only links write to the notice's
  // contact address; none leads into the app.
  expect(screen.getAllByRole('button')).toHaveLength(1);
  for (const link of screen.queryAllByRole('link'))
    expect(link).toHaveAttribute('href', 'mailto:it@osubb.ro');
});

it('asks again when the Member acknowledged only an older version', async () => {
  db.version = '1.1';
  db.acknowledged = ['1.0'];
  show();
  expect(await screen.findByRole('button', BUTTON)).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Acasă' })).toBeNull();
  expect(
    screen.getByText('Versiunea 1.1 · în vigoare de la', { exact: false }),
  ).toBeVisible();
});

it('opens the app for a Member who acknowledged the current version', async () => {
  db.acknowledged = ['1.1'];
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
    db.acknowledged = ['1.1'];
    return { data: {}, error: null };
  });
  show();
  await user.click(await screen.findByRole('button', BUTTON));
  expect(db.rpc).toHaveBeenCalledWith('acknowledge_privacy_notice', {
    p_version: '1.1',
  });
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();
});

it('treats an acknowledgement made in another tab as done', async () => {
  const user = userEvent.setup();
  db.rpc.mockImplementation(async () => {
    db.acknowledged = ['1.1'];
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

it('records the version on screen, never the older one the server still asks for', async () => {
  const user = userEvent.setup();
  // This build carries the 1.1 text before the server's migration has run.
  db.version = '1.0';
  db.rpc.mockImplementation(async () => ({
    data: null,
    error: { code: 'PT409', message: 'privacy_notice_version_stale' },
  }));
  show();
  await user.click(await screen.findByRole('button', BUTTON));
  expect(db.rpc).toHaveBeenCalledWith('acknowledge_privacy_notice', {
    p_version: '1.1',
  });
  expect(db.rpc).not.toHaveBeenCalledWith('acknowledge_privacy_notice', {
    p_version: '1.0',
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Politica de confidențialitate tocmai s-a actualizat.',
  );
  expect(screen.queryByRole('heading', { name: 'Acasă' })).toBeNull();
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
  db.acknowledged = ['1.1'];
  await user.click(screen.getByRole('button', { name: 'Încearcă din nou' }));
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();
});

it('asks again, without a new sign-in, when the version moves while the app is open', async () => {
  db.version = '1.0';
  db.acknowledged = ['1.0'];
  show();
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();

  db.version = '1.1';
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(await screen.findByRole('button', BUTTON)).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Acasă' })).toBeNull();
  focusManager.setFocused(undefined);
});

it('keeps the app open when a background re-read fails', async () => {
  db.acknowledged = ['1.1'];
  show();
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();

  db.settingsError = new Error('offline');
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(db.settingsReads).toBeGreaterThan(1));
  expect(screen.getByRole('heading', { name: 'Acasă' })).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
  focusManager.setFocused(undefined);
});

/* Audit D, D-19: the server's version is ahead of the text this bundle
   carries (a tab left open across a Release, a cached installed app). */

it('offers a reload, not a notice it cannot show, when the server is ahead of the bundle', async () => {
  const user = userEvent.setup();
  db.version = '1.2';
  db.acknowledged = ['1.1'];
  show();
  expect(await screen.findByRole('heading', NEW_VERSION)).toBeVisible();
  expect(screen.getByText(/versiunea 1\.2/)).toBeVisible();
  // Neither the older text nor its button: tapping it could only be stale.
  expect(screen.queryByRole('button', BUTTON)).toBeNull();
  expect(
    screen.queryByRole('heading', {
      name: 'Politica de confidențialitate a aplicației OSUBB',
    }),
  ).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Acasă' })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Reîncarcă aplicația' }));
  expect(reloadToLatestVersion).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('button', { name: 'Reîncarcă aplicația' }),
  ).toBeDisabled();
  expect(db.rpc).not.toHaveBeenCalled();
});

it('never locks the Member out when the server is ahead: "Mai târziu" opens the app', async () => {
  const user = userEvent.setup();
  db.version = '1.2';
  show();
  await user.click(await screen.findByRole('button', { name: 'Mai târziu' }));
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();
  expect(db.rpc).not.toHaveBeenCalled();
});

it('compares versions as numbers: 1.10 is ahead of the 1.1 bundle, 1.1.0 is not', async () => {
  db.version = '1.10';
  const first = show();
  expect(await screen.findByRole('heading', NEW_VERSION)).toBeVisible();
  first.unmount();

  db.version = '1.1.0';
  show();
  // Equal to the bundle: the notice itself.
  expect(await screen.findByRole('button', BUTTON)).toBeVisible();
  expect(screen.queryByRole('heading', NEW_VERSION)).toBeNull();
});

it('shows the reload step when the server moves ahead while the app is open', async () => {
  db.acknowledged = ['1.1'];
  show();
  expect(await screen.findByRole('heading', { name: 'Acasă' })).toBeVisible();

  db.version = '1.2';
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(await screen.findByRole('heading', NEW_VERSION)).toBeVisible();
  focusManager.setFocused(undefined);
});
