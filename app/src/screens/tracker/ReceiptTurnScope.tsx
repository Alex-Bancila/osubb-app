import { useMemo, useState, type ReactNode } from 'react';
import { ReceiptTurnContext } from './receipt-turn';

/**
 * One receipt at a time inside a surface with several commands (the Task
 * details sheet, Audit D-16): a new command's receipt replaces the previous
 * one instead of stacking beside it.
 */
export function ReceiptTurnScope({ children }: { children: ReactNode }) {
  const [owner, setOwner] = useState<string | null>(null);
  const value = useMemo(() => ({ owner, claim: setOwner }), [owner]);
  return (
    <ReceiptTurnContext.Provider value={value}>
      {children}
    </ReceiptTurnContext.Provider>
  );
}
