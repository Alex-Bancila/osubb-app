import { useId, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { describeFailure } from '../../lib/command-reasons';
import type { AdminGroup } from '../../queries/groups-admin';

const FAILED = 'Nu am putut dezarhiva grupul. Reîncearcă.';

/** Why a Child Group's Dezarhivează waits (#1110): its parent comes first. */
export const PARENT_ARCHIVED_REASON =
  'Grupul părinte este arhivat; dezarhivează-l întâi pe el.';

/**
 * **Dezarhivează** for one archived Group (#1110, ruling R65), shown only to
 * whoever may archive it. Under an archived parent it stays disabled and says
 * why beside it, rather than offering a call that can only be refused.
 */
export function UnarchiveButton({
  group,
  parentArchived,
  disabled,
  onClick,
}: {
  group: Pick<AdminGroup, 'name'>;
  parentArchived: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const reasonId = useId();
  return (
    <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {parentArchived && (
        <span id={reasonId} className="text-xs text-muted-foreground">
          {PARENT_ARCHIVED_REASON}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Dezarhivează ${group.name}`}
        aria-describedby={parentArchived ? reasonId : undefined}
        disabled={disabled || parentArchived}
        onClick={onClick}
      >
        Dezarhivează
      </Button>
    </span>
  );
}

/**
 * The confirmation behind **Dezarhivează** (#1110, ruling R65), the archive
 * pop-up's counterpart: it names the Group, lists the archived subgroups that
 * return with it, and says what does not come back — archiving's cancelled
 * Events and declined Applications stay as they are. A refusal shows inside
 * it; success closes it and the page reports it.
 */
export function GroupUnarchiveDialog({
  group,
  subgroups,
  open,
  onOpenChange,
  onUnarchive,
}: {
  group: Pick<AdminGroup, 'id' | 'name'>;
  subgroups: readonly Pick<AdminGroup, 'id' | 'name'>[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs `unarchive_group`; a refusal goes to `onFailure`. */
  onUnarchive: (onFailure: (failure: unknown) => void) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    setBusy(true);
    let refusal: unknown;
    const done = await onUnarchive((failure) => {
      refusal = failure;
    });
    setBusy(false);
    if (done) {
      onOpenChange(false);
      return;
    }
    setError(describeFailure(refusal, FAILED).message);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dezarhivează {group.name}</DialogTitle>
          <DialogDescription>
            Grupul redevine activ, cu membrii, funcțiile și setările lui.
          </DialogDescription>
        </DialogHeader>
        {subgroups.length > 0 && (
          <div className="space-y-1 text-sm">
            <p className="m-0">Revin și subgrupurile lui:</p>
            <ul
              aria-label="Subgrupuri care revin"
              className="m-0 list-disc ps-5"
            >
              {subgroups.map((subgroup) => (
                <li key={subgroup.id}>{subgroup.name}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="m-0 text-sm text-muted-foreground">
          Evenimentele anulate la arhivare rămân anulate, iar cererile de
          înscriere respinse rămân respinse.
        </p>
        {error && (
          <p role="alert" className="m-0 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Renunță
          </Button>
          <Button type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Se dezarhivează…' : 'Dezarhivează'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
