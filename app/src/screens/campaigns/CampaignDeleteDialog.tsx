import { useState } from 'react';
import {
  Consequences,
  DeleteForGoodDialog,
  type DeleteDialogControls,
} from '../../components/delete-for-good/DeleteForGoodDialog';
import { Button } from '../../components/ui/button';
import { DialogDescription, DialogFooter } from '../../components/ui/dialog';
import { describeFailure } from '../../lib/command-reasons';
import { useDeleteCampaign } from '../../queries/delete-for-good';
import type { Campaign } from '../../queries/campaigns';

import { campaignDeletedReceipt } from './campaign-delete-receipt';

const FAILED = 'Nu am putut șterge campania. Încearcă din nou.';

/**
 * **Șterge definitiv** on a Campanii row (#1017), beside Redenumește and
 * Activează, for the same managers. A Campaign is a reporting label
 * (ADR-0007): its Tasks and Events stay, without the label.
 */
export function CampaignDeleteDialog({
  campaign,
  disabled,
  onDeleted,
}: {
  campaign: Pick<Campaign, 'id' | 'name'>;
  disabled: boolean;
  onDeleted: (receipt: string) => void;
}) {
  return (
    <DeleteForGoodDialog title="Ștergi definitiv campania?" disabled={disabled}>
      {(controls) => (
        <CampaignDeleteBody
          campaign={campaign}
          controls={controls}
          onDeleted={onDeleted}
        />
      )}
    </DeleteForGoodDialog>
  );
}

function CampaignDeleteBody({
  campaign,
  controls,
  onDeleted,
}: {
  campaign: Pick<Campaign, 'id' | 'name'>;
  controls: DeleteDialogControls;
  onDeleted: (receipt: string) => void;
}) {
  const remove = useDeleteCampaign();
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setError(null);
    controls.setBusy(true);
    try {
      const result = await remove.mutateAsync(campaign.id);
      controls.close(true);
      onDeleted(campaignDeletedReceipt(campaign.name, result));
    } catch (failure) {
      controls.setBusy(false);
      setError(describeFailure(failure, FAILED).message);
    }
  }
  const pending = remove.isPending;
  return (
    <>
      <DialogDescription>
        „{campaign.name}” dispare din liste, din filtre și din rapoarte. Nu
        poate fi recuperată.
      </DialogDescription>
      <Consequences
        label="Ce se întâmplă cu campania"
        items={[
          'Taskurile și evenimentele etichetate cu ea rămân, fără etichetă.',
          'Punctele acordate pentru ele rămân ale membrilor.',
        ]}
      />
      {error && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => controls.close()}
        >
          Renunță
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => void confirm()}
        >
          {pending ? 'Se șterge…' : 'Șterge definitiv'}
        </Button>
      </DialogFooter>
    </>
  );
}
