import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as axe from 'axe-core';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommandError } from '../../lib/command-reasons';
import type {
  AdminGroup,
  GroupAuthority,
  GroupCommand,
} from '../../queries/groups-admin';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
import { GroupSettingsTab } from './GroupSettingsTab';

/*
 * #698 (ruling R18): the Group's "Formular de înscriere" link in the settings
 * form — two fields saved and cleared together, checked on blur and on save
 * by the rules update_group applies, and the server's refusals shown under
 * the same fields.
 */

const FORM_URL = 'https://forms.example.org/logistica';

const run =
  vi.fn<
    (
      command: GroupCommand,
      onFailure?: (failure: unknown) => void,
    ) => Promise<boolean>
  >();

const authority: GroupAuthority = {
  manageWork: true,
  manageGroup: true,
  editStructure: false,
  appointManager: false,
  archive: false,
  editMinLevel: true,
};

function group(extra: Partial<AdminGroup> = {}): AdminGroup {
  return {
    id: 2,
    name: 'Logistică',
    short: null,
    color: null,
    category: 'team',
    path: [1, 2],
    parent_id: 1,
    min_level: 1,
    status: 'active',
    is_organization: false,
    is_private: false,
    manager_title: null,
    automatic_membership: false,
    accepts_applications: true,
    application_level: 1,
    competes_in_cup: false,
    counts_toward_parent_cup: true,
    shared_work_visibility: false,
    application_form_label: null,
    application_form_url: null,
    memberCount: 3,
    ...extra,
  };
}

function show(stored: Partial<AdminGroup> = {}) {
  return render(
    <MemoryRouter>
      <GroupSettingsTab
        group={group(stored)}
        parent={undefined}
        roster={[]}
        authority={authority}
        levels={[0, 1, 2, 3, 5, 6]}
        actorLevel={6}
        busy={false}
        error={null}
        lastReason={undefined}
        onRun={run}
      />
    </MemoryRouter>,
  );
}

const labelField = () => screen.getByLabelText('Eticheta butonului');
const urlField = () => screen.getByLabelText('Adresa formularului');
const save = () =>
  userEvent.click(screen.getByRole('button', { name: 'Salvează setările' }));

beforeEach(() => {
  run.mockReset().mockResolvedValue(true);
});

it('shows the two fields in a "Formular de înscriere" fieldset, filled from the stored link', async () => {
  const { container } = show({
    application_form_label: 'Înscrie-te',
    application_form_url: FORM_URL,
  });
  expect(
    screen.getByRole('group', { name: 'Formular de înscriere' }),
  ).toBeVisible();
  expect(labelField()).toHaveValue('Înscrie-te');
  expect(urlField()).toHaveValue(FORM_URL);
  expect(
    (
      await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it('saves the pair together, trimmed, as p_application_form_label / _url', async () => {
  const user = userEvent.setup();
  show();
  await user.type(labelField(), '  Completează formularul ');
  await user.type(urlField(), ` ${FORM_URL} `);
  await save();
  expect(run).toHaveBeenCalledWith(
    {
      kind: 'settings',
      groupId: 2,
      name: 'Logistică',
      managerTitle: null,
      acceptsApplications: true,
      applicationLevel: 1,
      sharedWorkVisibility: false,
      minLevel: 1,
      applicationFormLabel: 'Completează formularul',
      applicationFormUrl: FORM_URL,
      confirmRemovals: false,
    },
    expect.any(Function),
  );
});

it('clears the pair together when both fields are emptied', async () => {
  const user = userEvent.setup();
  show({
    application_form_label: 'Înscrie-te',
    application_form_url: FORM_URL,
  });
  await user.clear(labelField());
  await user.clear(urlField());
  await save();
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'settings',
      applicationFormLabel: null,
      applicationFormUrl: null,
    }),
    expect.any(Function),
  );
});

it('asks for both halves, on blur and on save, under the half left empty', async () => {
  const user = userEvent.setup();
  show();
  await user.type(labelField(), 'Înscrie-te');
  await user.click(urlField());
  await user.tab();
  expect(urlField()).toHaveAccessibleDescription(
    'Completează și eticheta, și adresa.',
  );
  await save();
  expect(run).not.toHaveBeenCalled();
  expect(urlField()).toHaveAccessibleDescription(
    'Completează și eticheta, și adresa.',
  );

  // The other way round: an address with no label.
  await user.clear(labelField());
  await user.type(urlField(), FORM_URL);
  await save();
  expect(run).not.toHaveBeenCalled();
  expect(labelField()).toHaveAccessibleDescription(
    'Completează și eticheta, și adresa.',
  );
});

it('limits the label to 60 characters, checked on blur', async () => {
  const user = userEvent.setup();
  show();
  await user.type(urlField(), FORM_URL);
  await user.type(labelField(), 'e'.repeat(61));
  await user.tab();
  expect(labelField()).toHaveAccessibleDescription(
    'Eticheta are cel mult 60 de caractere.',
  );
  await save();
  expect(run).not.toHaveBeenCalled();
  await user.clear(labelField());
  await user.type(labelField(), 'e'.repeat(60));
  await save();
  expect(run).toHaveBeenCalledTimes(1);
});

it('asks for an http(s) address of at most 2048 characters', async () => {
  const user = userEvent.setup();
  show();
  await user.type(labelField(), 'Înscrie-te');
  await user.type(urlField(), 'forms.example.org/logistica');
  await user.tab();
  expect(urlField()).toHaveAccessibleDescription(
    'Adresa trebuie să înceapă cu http:// sau https://.',
  );
  await user.clear(urlField());
  // Pasted, not typed: 2049 keystrokes would be slow for no gain.
  await user.click(urlField());
  await user.paste(`https://${'a'.repeat(2041)}`);
  await user.tab();
  expect(urlField()).toHaveAccessibleDescription(
    'Adresa are cel mult 2048 de caractere.',
  );
  await save();
  expect(run).not.toHaveBeenCalled();
});

it.each([
  ['link_incomplete', 'url', 'Completează și eticheta, și adresa.'],
  ['link_label_too_long', 'label', 'Eticheta are cel mult 60 de caractere.'],
  [
    'link_url_invalid',
    'url',
    'Adresa trebuie să înceapă cu http:// sau https://.',
  ],
  ['link_url_too_long', 'url', 'Adresa are cel mult 2048 de caractere.'],
])(
  "shows update_group's %s under the %s field, in this form's words",
  async (reason, field, copy) => {
    const user = userEvent.setup();
    run.mockImplementation(async (_command, onFailure) => {
      onFailure?.(new CommandError({ code: 'PT400', message: reason }, 'x'));
      return false;
    });
    show();
    await user.type(labelField(), 'Înscrie-te');
    await user.type(urlField(), FORM_URL);
    await save();
    expect(run).toHaveBeenCalledTimes(1);
    expect(
      field === 'label' ? labelField() : urlField(),
    ).toHaveAccessibleDescription(copy);
  },
);
