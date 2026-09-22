import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
  GroupOption,
  MemberOption,
  groupOptionLabel,
  type GroupOptionGroup,
} from './combobox';

const adunarea: GroupOptionGroup = {
  id: 1,
  name: 'Adunarea Generală',
  path: [1],
};
const educational: GroupOptionGroup = {
  id: 2,
  name: 'Educațional',
  path: [1, 2],
};
const mentorat: GroupOptionGroup = {
  id: 3,
  name: 'Echipa de mentorat',
  path: [1, 2, 3],
};
const imagine: GroupOptionGroup = { id: 4, name: 'Imagine', path: [1, 4] };
const groups = [adunarea, educational, mentorat, imagine];
const groupsById = new Map(groups.map((group) => [group.id, group]));

type Member = { id: string; name: string };
const members: Member[] = [
  { id: 'a', name: 'Ana Pop' },
  { id: 'b', name: 'Bogdan Ionescu' },
  { id: 'c', name: 'Bianca Mureșan' },
];

function MemberPicker({
  onValueChange,
}: {
  onValueChange?: (member: Member | null) => void;
}) {
  return (
    <Combobox
      items={members}
      itemToStringLabel={(member: Member) => member.name}
      onValueChange={onValueChange}
    >
      <ComboboxTrigger aria-label="Executant">
        <ComboboxValue placeholder="Alege un membru" />
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput placeholder="Caută un membru" />
        <ComboboxEmpty />
        <ComboboxList>
          {(member: Member) => (
            <ComboboxItem key={member.id} value={member}>
              <MemberOption name={member.name} />
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

describe('Combobox', () => {
  it('searches inside the dropdown, then Enter picks the highlighted option', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<MemberPicker onValueChange={onValueChange} />);
    const trigger = screen.getByRole('combobox', { name: 'Executant' });

    await user.click(trigger);
    const search = await screen.findByPlaceholderText('Caută un membru');
    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.getAllByRole('option')).toHaveLength(3);

    await user.keyboard('bi');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option')).toHaveTextContent('Bianca Mureșan');

    await user.keyboard('{ArrowDown}');
    const option = screen.getByRole('option', { name: 'Bianca Mureșan' });
    expect(search).toHaveAttribute('aria-activedescendant', option.id);

    await user.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith(
      members[2],
      expect.anything(),
    );
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger).toHaveTextContent('Bianca Mureșan');
  });

  it('says so in Romanian when nothing matches', async () => {
    const user = userEvent.setup();
    render(<MemberPicker />);

    await user.click(screen.getByRole('combobox', { name: 'Executant' }));
    await user.type(
      await screen.findByPlaceholderText('Caută un membru'),
      'zzz',
    );

    expect(await screen.findByText('Niciun rezultat')).toBeVisible();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<MemberPicker />);
    const trigger = screen.getByRole('combobox', { name: 'Executant' });

    await user.click(trigger);
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

describe('GroupOption', () => {
  it('names a Child Group together with its direct parent', () => {
    expect(groupOptionLabel(mentorat, groupsById)).toBe(
      'Echipa de mentorat · Educațional',
    );
    render(<GroupOption group={imagine} groupsById={groupsById} />);
    expect(screen.getByText('Imagine')).toBeVisible();
    expect(screen.getByText('Adunarea Generală')).toBeVisible();
  });

  it('lets the search match a Child Group by its parent', async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        items={groups}
        itemToStringLabel={(group: GroupOptionGroup) =>
          groupOptionLabel(group, groupsById)
        }
      >
        <ComboboxTrigger aria-label="Grup">
          <ComboboxValue placeholder="Alege un grup" />
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxInput placeholder="Caută un grup" />
          <ComboboxList>
            {(group: GroupOptionGroup) => (
              <ComboboxItem key={group.id} value={group}>
                <GroupOption group={group} groupsById={groupsById} />
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Grup' }));
    await user.type(await screen.findByPlaceholderText('Caută un grup'), 'edu');

    await waitFor(() =>
      expect(
        screen.getAllByRole('option').map((option) => option.textContent),
      ).toEqual([
        'Educațional· Adunarea Generală',
        'Echipa de mentorat· Educațional',
      ]),
    );
  });

  it('names a top-level Group alone', () => {
    expect(groupOptionLabel(adunarea, groupsById)).toBe('Adunarea Generală');
    const { container } = render(
      <GroupOption group={adunarea} groupsById={groupsById} />,
    );
    expect(container).toHaveTextContent(/^Adunarea Generală$/);
  });

  it('falls back to the name alone when the parent is not loaded', () => {
    expect(groupOptionLabel(educational, new Map())).toBe('Educațional');
  });
});

describe('MemberOption', () => {
  it('shows initials on the member colour and loads no image without a thumbnail', () => {
    const { container } = render(
      <MemberOption name="Ana Pop" avatarColor="#123456" />,
    );

    expect(screen.getByText('Ana Pop')).toBeVisible();
    const avatar = container.querySelector('[data-slot="member-avatar"]');
    expect(avatar).toHaveTextContent('AP');
    expect(avatar).toHaveStyle({ background: '#123456' });
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back to the brand colour', () => {
    const { container } = render(<MemberOption name="Ana Pop" />);
    const avatar = container.querySelector<HTMLElement>(
      '[data-slot="member-avatar"]',
    );
    expect(avatar?.style.background).toBe('var(--brand-red)');
  });

  it('loads only a small, lazy thumbnail when one exists', () => {
    const { container } = render(
      <MemberOption name="Ana Pop" avatarUrl="https://example.test/ana.webp" />,
    );

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute('src', 'https://example.test/ana.webp');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(Number(image?.getAttribute('width'))).toBeLessThanOrEqual(32);
    expect(Number(image?.getAttribute('height'))).toBeLessThanOrEqual(32);
  });
});
