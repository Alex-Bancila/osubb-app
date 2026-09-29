import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { useReceiptTurn } from './receipt-turn';
import { ReceiptTurnScope } from './ReceiptTurnScope';

function Command({ label, receipt }: { label: string; receipt: string }) {
  const [done, setDone] = useState(false);
  const turn = useReceiptTurn();
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setDone(true);
          turn.claim();
        }}
      >
        {label}
      </button>
      {done && turn.current && <p role="status">{receipt}</p>}
    </div>
  );
}

/* Audit D-16: "Modificările au fost salvate…" stayed beside "Executorul a
   fost atribuit." — in the sheet only the latest command's receipt shows. */
it('shows only the latest receipt inside a scope', async () => {
  const user = userEvent.setup();
  render(
    <ReceiptTurnScope>
      <Command label="Salvează" receipt="Modificările au fost salvate." />
      <Command label="Atribuie" receipt="Executorul a fost atribuit." />
    </ReceiptTurnScope>,
  );

  await user.click(screen.getByRole('button', { name: 'Salvează' }));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Modificările au fost salvate.',
  );
  await user.click(screen.getByRole('button', { name: 'Atribuie' }));
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Executorul a fost atribuit.',
  );
});

it('leaves every receipt alone outside a scope', async () => {
  const user = userEvent.setup();
  render(
    <>
      <Command label="Salvează" receipt="Salvat." />
      <Command label="Atribuie" receipt="Atribuit." />
    </>,
  );
  await user.click(screen.getByRole('button', { name: 'Salvează' }));
  await user.click(screen.getByRole('button', { name: 'Atribuie' }));
  expect(screen.getAllByRole('status')).toHaveLength(2);
});
