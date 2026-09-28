import { useMemo, useState } from 'react';
import { PlusIcon } from 'lucide-react';

import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useAuth } from '../../lib/auth';
import {
  useCreateEvent,
  useEventFormOptions,
} from '../../queries/event-creation';
import { EventForm } from './EventForm';
import {
  eventDialogContentClass,
  groupsAvailableAtLevel,
  type EventFormOptions,
} from './event-form-model';

/** Calendar's kind gate. The command remains the authorization boundary. */
export function NewEventControl() {
  const { claims } = useAuth();
  const options = useEventFormOptions();
  const actorLevel = claims?.member_level ?? 0;
  const available = useMemo(
    () =>
      options.data ? groupsAvailableAtLevel(options.data, actorLevel) : [],
    [actorLevel, options.data],
  );

  if (!claims || !options.data || available.length === 0) return null;
  return (
    <NewEventDialog
      options={{ ...options.data, groups: available }}
      actorLevel={actorLevel}
    />
  );
}

function NewEventDialog({
  options,
  actorLevel,
}: {
  options: EventFormOptions;
  actorLevel: number;
}) {
  const create = useCreateEvent();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.isPending) return;
        setOpen(next);
      }}
    >
      <Button
        type="button"
        className="min-h-11 shrink-0"
        onClick={() => {
          setAttempt((current) => current + 1);
          setOpen(true);
        }}
      >
        <PlusIcon aria-hidden="true" />
        Eveniment nou
      </Button>
      <DialogContent className={eventDialogContentClass}>
        <DialogHeader>
          <DialogTitle>Eveniment nou</DialogTitle>
          <DialogDescription>
            Publică o întâlnire, activitate sau dată importantă într-un grup pe
            care îl gestionezi. Orele sunt interpretate în fusul României.
          </DialogDescription>
        </DialogHeader>
        <EventForm
          key={attempt}
          options={options}
          actorLevel={actorLevel}
          pending={create.isPending}
          onCancel={() => setOpen(false)}
          onSubmit={async (draft) => {
            await create.mutateAsync(draft);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
