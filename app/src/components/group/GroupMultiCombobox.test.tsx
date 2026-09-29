import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { chosenGroupsLabel } from './chosen-groups-label';
import { GroupMultiCombobox } from './GroupMultiCombobox';

const TEAM = { id: 2, name: 'Echipa App', path: [1, 2] };
const GROUPS = [{ id: 1, name: 'Educațional', path: [1] }, TEAM];
const BY_ID = new Map(GROUPS.map((group) => [group.id, group]));

function Picker({ initial }: { initial: typeof GROUPS }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <span id="label">Grupuri</span>
      <GroupMultiCombobox
        ariaLabelledBy="label"
        groups={GROUPS}
        groupsById={BY_ID}
        value={value}
        onValueChange={setValue}
        placeholder="Niciun grup"
      />
    </>
  );
}

it('counts the chosen Groups in Romanian', () => {
  expect(chosenGroupsLabel(1)).toBe('1 grup ales');
  expect(chosenGroupsLabel(2)).toBe('2 grupuri alese');
  expect(chosenGroupsLabel(19)).toBe('19 grupuri alese');
  expect(chosenGroupsLabel(20)).toBe('20 de grupuri alese');
  expect(chosenGroupsLabel(101)).toBe('101 grupuri alese');
});

it('shows each chosen Group as a chip named with its parent, and returns focus to the trigger when the last goes', async () => {
  const user = userEvent.setup();
  render(<Picker initial={[TEAM]} />);
  const trigger = screen.getByRole('combobox', { name: 'Grupuri' });
  expect(trigger).toHaveTextContent('1 grup ales');
  const chip = screen.getByRole('button', {
    name: 'Scoate grupul Echipa App · Educațional',
  });
  await user.click(chip);
  expect(screen.queryByRole('list', { name: 'Grupuri alese' })).toBeNull();
  expect(trigger).toHaveTextContent('Niciun grup');
  expect(trigger).toHaveFocus();
});
