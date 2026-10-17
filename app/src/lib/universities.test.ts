import { expect, it } from 'vitest';
import {
  isUbbStudent,
  OTHER_UNIVERSITY,
  UBB,
  UNIVERSITIES,
  universityOption,
} from './universities';

it('lists Universitatea Babeș-Bolyai first, then the other Cluj universities', () => {
  expect(UBB).toBe('Universitatea Babeș-Bolyai');
  expect(UNIVERSITIES).toEqual([
    'Universitatea Babeș-Bolyai',
    'Universitatea Tehnică din Cluj-Napoca',
    'Universitatea de Medicină și Farmacie „Iuliu Hațieganu”',
    'Universitatea de Științe Agricole și Medicină Veterinară Cluj-Napoca',
    'Universitatea de Artă și Design din Cluj-Napoca',
    'Academia Națională de Muzică „Gheorghe Dima”',
    'Universitatea Sapientia',
  ]);
});

it('names the list entry a stored value is, or Altă universitate for any other', () => {
  expect(universityOption(UBB)).toBe(UBB);
  expect(universityOption('Universitatea Sapientia')).toBe(
    'Universitatea Sapientia',
  );
  expect(universityOption('Universitatea din București')).toBe(
    OTHER_UNIVERSITY,
  );
  expect(universityOption(null)).toBeNull();
});

it('counts only Universitatea Babeș-Bolyai as a UBB student', () => {
  expect(isUbbStudent(UBB)).toBe(true);
  expect(isUbbStudent('Universitatea Sapientia')).toBe(false);
  expect(isUbbStudent('Universitatea din București')).toBe(false);
  expect(isUbbStudent(null)).toBe(false);
  expect(isUbbStudent(undefined)).toBe(false);
});
