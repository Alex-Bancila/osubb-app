import { expect, it } from 'vitest';
import { countsLine, eligibleCount, showConsequence } from './message-text';

it('counts the Voluntari Activi with the Romanian plural', () => {
  expect(eligibleCount(1)).toBe('1 Voluntar Activ student UBB');
  expect(eligibleCount(2)).toBe('2 Voluntari Activi studenți UBB');
  expect(eligibleCount(19)).toBe('19 Voluntari Activi studenți UBB');
  expect(eligibleCount(20)).toBe('20 de Voluntari Activi studenți UBB');
  expect(eligibleCount(101)).toBe('101 Voluntari Activi studenți UBB');
  expect(eligibleCount(120)).toBe('120 de Voluntari Activi studenți UBB');
});

it('says how many answered, and what happens with nobody eligible', () => {
  expect(countsLine(12, 30)).toBe(
    'Confirmat de 12 din 30 de Voluntari Activi studenți UBB.',
  );
  expect(countsLine(0, 1)).toBe(
    'Confirmat de 0 din 1 Voluntar Activ student UBB.',
  );
  expect(countsLine(0, 0)).toBe(
    'Nu există acum niciun Voluntar Activ student UBB. Mesajul apare celor care devin.',
  );
});

it('names the consequence of publishing and of asking again', () => {
  expect(showConsequence(30, false)).toBe(
    'Toți cei 30 de Voluntari Activi studenți UBB vor vedea mesajul și vor trebui să-l confirme.',
  );
  expect(showConsequence(3, true)).toBe(
    'Toți cei 3 Voluntari Activi studenți UBB vor vedea din nou mesajul și vor trebui să-l confirme.',
  );
  expect(showConsequence(1, true)).toBe(
    'Singurul Voluntar Activ student UBB va vedea din nou mesajul și va trebui să-l confirme.',
  );
  expect(showConsequence(0, false)).toMatch(/^Nu există acum niciun/);
  // The count did not load: the sentence without a number.
  expect(showConsequence(undefined, false)).toBe(
    'Toți Voluntarii Activi studenți UBB vor vedea mesajul și vor trebui să-l confirme.',
  );
});
