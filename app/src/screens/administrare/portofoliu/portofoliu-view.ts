import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';

/**
 * The query-string key and the values of Portofoliu Interne's three views
 * (R58, Alex 2026-10-20): the two kinds of Role Evaluation, each with its own
 * run form, Candidates, Signals and runs, and **Setări**.
 */
export const PORTOFOLIU_VIEW_KEY = 'vedere';
const ADUNAREA_GENERALA_VALUE = 'adunarea-generala';
const SETARI_VALUE = 'setari';

/** The page's address, and the way to its Setări view (a link from anywhere). */
export const PORTOFOLIU_PATH = '/administrare/portofoliu-interne';
export const SETARI_HREF = `${PORTOFOLIU_PATH}?${PORTOFOLIU_VIEW_KEY}=${SETARI_VALUE}`;

/** A kind's view, or **Setări**. */
export type PortofoliuView = RoleEvaluationKind | 'setari';

/**
 * The page's view. The URL decides — `?vedere=adunarea-generala` or
 * `?vedere=setari` — so a reload, Back and a shared link keep it; no key, or a
 * value that is neither, is Voluntar Activ, never an error. Choosing replaces
 * the history entry (Back does not walk through the choices), keeps every
 * other key, and removes this one for Voluntar Activ.
 */
export function usePortofoliuView() {
  const [params, setParams] = useSearchParams();
  const value = params.get(PORTOFOLIU_VIEW_KEY);
  const view: PortofoliuView =
    value === SETARI_VALUE
      ? 'setari'
      : value === ADUNAREA_GENERALA_VALUE
        ? 'adunarea_generala'
        : 'voluntar_activ';
  const choose = useCallback(
    (next: PortofoliuView) =>
      setParams(
        (current) => {
          const nextParams = new URLSearchParams(current);
          if (next === 'setari')
            nextParams.set(PORTOFOLIU_VIEW_KEY, SETARI_VALUE);
          else if (next === 'adunarea_generala')
            nextParams.set(PORTOFOLIU_VIEW_KEY, ADUNAREA_GENERALA_VALUE);
          else nextParams.delete(PORTOFOLIU_VIEW_KEY);
          return nextParams;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [view, choose] as const;
}
