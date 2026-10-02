// #991: invented volunteer-sheet fixtures shared by the parser and the
// csv-import tests. The real sheet never enters the repository.
import type {
  ImportContext,
  KnownAddress,
  SheetGroup,
} from "./volunteer-sheet.ts";

export const SHEET_HEADER =
  "Nume & Prenume,Funcția,Email,Număr de telefon,Departament PRINCIPAL,Departament secundar,Departament secundar,Departament secundar,Departament secundar,Data Nașterii,Universitatea,Facultatea,Specializarea,Nivel,An de studiu";

export function sheet(...rows: string[]): string {
  return [SHEET_HEADER, ...rows].join("\n") + "\n";
}

export const GROUPS: SheetGroup[] = [
  {
    id: 1,
    name: "Imagine & PR",
    short: "IMG&PR",
    topLevel: true,
    isOrganization: false,
  },
  {
    id: 2,
    name: "Tineret",
    short: "TIN",
    topLevel: true,
    isOrganization: false,
  },
  {
    id: 3,
    name: "Financiar",
    short: "FIN",
    topLevel: true,
    isOrganization: false,
  },
  {
    id: 4,
    name: "Resurse Umane",
    short: "HR",
    topLevel: true,
    isOrganization: false,
  },
  { id: 5, name: "OSUBB", short: "ORG", topLevel: true, isOrganization: true },
  {
    id: 8,
    name: "Educațional",
    short: "EDU",
    topLevel: true,
    isOrganization: false,
  },
  {
    id: 9,
    name: "Echipa IT",
    short: null,
    topLevel: false,
    isOrganization: false,
  },
  {
    id: 60,
    name: "Festivalul Studențesc",
    short: null,
    topLevel: true,
    isOrganization: false,
  },
  {
    id: 63,
    name: "Biroul de Conducere",
    short: null,
    topLevel: true,
    isOrganization: false,
  },
];

export function context(
  known: Record<string, KnownAddress> = {},
  boardGroupId: number | null = 63,
): ImportContext {
  return {
    groups: GROUPS,
    boardGroupId,
    known: new Map(Object.entries(known)),
  };
}
