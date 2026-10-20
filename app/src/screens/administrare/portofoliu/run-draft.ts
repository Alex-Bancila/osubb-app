import { useState } from 'react';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';
import type { RankingRow, RunValues } from '../../../queries/role-evaluations';

/** What the member has typed over the values the settings prefill. */
export type Edits = Partial<{
  from: string;
  to: string;
  name: string;
  percent: string;
}>;

/**
 * The form as the fields hold it: text, until a schema reads it. The Prag
 * minim and the Data limită de intrare are not fields: they are settings,
 * edited only in Setări.
 */
export type FormValues = {
  kind: RoleEvaluationKind;
  from: string;
  to: string;
  name: string;
  percent: string;
};

/** A Simulation shown: the values it used, the form they came from, its rows. */
export type Simulated = {
  values: Omit<RunValues, 'name'>;
  input: FormValues;
  rows: RankingRow[];
};

/**
 * What a kind's run form holds besides the settings: what was typed over the
 * prefilled values, and the Simulation shown, if any. Plain data, so the page
 * can keep it while the form is not on screen (a visit to Setări) and hand it
 * back.
 */
export type RunDraft = { edits: Edits; simulated: Simulated | null };

export const EMPTY_DRAFT: RunDraft = { edits: {}, simulated: null };

/** A change of a draft, from the draft before it. */
export type DraftUpdate = (previous: RunDraft) => RunDraft;

/**
 * One draft per kind, kept by the page that mounts the run form: Voluntar
 * Activ and Adunarea Generală are separate runs, each with its own name and
 * period. The page spreads `draftOf(kind)` into the panel.
 */
export function useRunDrafts() {
  const [drafts, setDrafts] = useState<Record<RoleEvaluationKind, RunDraft>>({
    voluntar_activ: EMPTY_DRAFT,
    adunarea_generala: EMPTY_DRAFT,
  });
  return (kind: RoleEvaluationKind) => ({
    draft: drafts[kind],
    onDraft: (update: DraftUpdate) =>
      setDrafts((all) => ({ ...all, [kind]: update(all[kind]) })),
  });
}
