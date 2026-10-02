import { expect, it } from 'vitest';
import { planDepartmentChange } from './department-edit';

const member = (groupId: number) => ({ groupId, groupRole: 'member' as const });
const add = (groupId: number) => ({
  kind: 'addMember',
  groupId,
  memberId: 'm',
});
const remove = (groupId: number) => ({
  kind: 'removeMember',
  groupId,
  memberId: 'm',
});

it('adds and removes other Departments, the principal one untouched', () => {
  expect(planDepartmentChange('m', [member(1), member(2)], 1, [3])).toEqual({
    kind: 'commands',
    commands: [add(3), remove(2)],
  });
});

it('changes nothing when nothing changed', () => {
  expect(planDepartmentChange('m', [member(1), member(2)], 1, [2])).toEqual({
    kind: 'commands',
    commands: [],
  });
});

it('makes a new Department principal by joining it before re-joining the kept ones', () => {
  // Principal = earliest joined (R17): 1 and 2 must go and 2 come back after 3.
  expect(planDepartmentChange('m', [member(1), member(2)], 3, [2])).toEqual({
    kind: 'commands',
    commands: [remove(1), remove(2), add(3), add(2)],
  });
});

it('promotes a secondary Department by leaving only what was joined before it', () => {
  expect(
    planDepartmentChange('m', [member(1), member(2), member(3)], 2, [1, 3]),
  ).toEqual({ kind: 'commands', commands: [remove(1), add(1)] });
});

it('leaves every Department when none is chosen', () => {
  expect(planDepartmentChange('m', [member(1), member(2)], null, [])).toEqual({
    kind: 'commands',
    commands: [remove(1), remove(2)],
  });
});

it('never cycles a Department the Member holds an Appointment in', () => {
  expect(
    planDepartmentChange(
      'm',
      [{ groupId: 1, groupRole: 'manager' }, member(2)],
      2,
      [1],
    ),
  ).toEqual({ kind: 'blocked', groupId: 1 });
});
