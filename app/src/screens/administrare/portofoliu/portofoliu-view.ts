import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';

/**
 * The query-string key and the values of Portofoliu Interne's four views
 * (R58, Alex 2026-10-20; R66): the two kinds of Role Evaluation, each with its
 * own run form, Candidates, Signals and runs, **Mesaj** (the Adherence
 * Message) and **Setări**.
 */
export const PORTOFOLIU_VIEW_KEY = 'vedere';
const ADUNAREA_GENERALA_VALUE = 'adunarea-generala';
const MESAJ_VALUE = 'mesaj';
const SETARI_VALUE = 'setari';

/** The page's address, and the way to its Setări view (a link from anywhere). */
export const PORTOFOLIU_PATH = '/administrare/portofoliu-interne';
export const SETARI_HREF = `${PORTOFOLIU_PATH}?${PORTOFOLIU_VIEW_KEY}=${SETARI_VALUE}`;

/** A kind's view, **Mesaj** or **Setări**. */
export type PortofoliuView = RoleEvaluationKind | 'mesaj' | 'setari';

const VALUE_OF: Readonly<Record<PortofoliuView, string | null>> = {
  voluntar_activ: null,
  adunarea_generala: ADUNAREA_GENERALA_VALUE,
  mesaj: MESAJ_VALUE,
  setari: SETARI_VALUE,
};

function viewOf(value: string | null): PortofoliuView {
  switch (value) {
    case ADUNAREA_GENERALA_VALUE:
      return 'adunarea_generala';
    case MESAJ_VALUE:
      return 'mesaj';
    case SETARI_VALUE:
      return 'setari';
    default:
      return 'voluntar_activ';
  }
}

/**
 * The page's view. The URL decides — `?vedere=adunarea-generala`,
 * `?vedere=mesaj` or `?vedere=setari` — so a reload, Back and a shared link
 * keep it; no key, or a value that is none of them, is Voluntar Activ, never
 * an error. Choosing replaces the history entry (Back does not walk through
 * the choices), keeps every other key, and removes this one for Voluntar
 * Activ.
 */
export function usePortofoliuView() {
  const [params, setParams] = useSearchParams();
  const view = viewOf(params.get(PORTOFOLIU_VIEW_KEY));
  const choose = useCallback(
    (next: PortofoliuView) =>
      setParams(
        (current) => {
          const nextParams = new URLSearchParams(current);
          const value = VALUE_OF[next];
          if (value === null) nextParams.delete(PORTOFOLIU_VIEW_KEY);
          else nextParams.set(PORTOFOLIU_VIEW_KEY, value);
          return nextParams;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [view, choose] as const;
}
