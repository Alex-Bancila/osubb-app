import { createContext, useCallback, useContext, useId } from 'react';

export type ReceiptTurns = {
  /** The control whose receipt is the latest; `null` before any command. */
  owner: string | null;
  claim: (id: string) => void;
};

/** Provided by `ReceiptTurnScope`. */
export const ReceiptTurnContext = createContext<ReceiptTurns | null>(null);

/**
 * A control's turn to show its receipt. Call `claim()` when the receipt is
 * set; `current` is false once another control in the scope has claimed
 * after it. Outside a scope every receipt is current.
 */
export function useReceiptTurn(): { current: boolean; claim: () => void } {
  const id = useId();
  const scope = useContext(ReceiptTurnContext);
  const claimScope = scope?.claim;
  const claim = useCallback(() => claimScope?.(id), [claimScope, id]);
  return {
    current: !scope || scope.owner === null || scope.owner === id,
    claim,
  };
}
