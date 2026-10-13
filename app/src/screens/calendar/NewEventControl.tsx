import { useMemo, useState } from 'react';
import { PlusIcon } from 'lucide-react';

import { FabAction } from '../../components/layout';
import { FormSheet } from '../../components/ui/form-sheet';
import { useAuth } from '../../lib/auth';
import {
  useCreateEvent,
  useEventFormOptions,
} from '../../queries/event-creation';
import { EventForm } from './EventForm';
import { setEventReceipt } from './event-receipts';
import {
  groupsAvailableAtLevel,
  type EventFormOptions,
} from './event-form-model';

/** Calendar's kind gate. The command remains the authorization boundary. */
export function NewEventControl({
  onCreated,
}: {
  /** The Calendar brings the new Event into view (Audit D-11). */
  onCreated?: (eventId: number) => void;
} = {}) {
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
      onCreated={onCreated}
    />
  );
}

function NewEventDialog({
  options,
  actorLevel,
  onCreated,
}: {
  options: EventFormOptions;
  actorLevel: number;
  onCreated?: (eventId: number) => void;
}) {
  const create = useCreateEvent();
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <>
      <FabAction
        label="Eveniment nou"
        icon={PlusIcon}
        className="shrink-0"
        onSelect={() => {
          setAttempt((current) => current + 1);
          setOpen(true);
        }}
      />
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title="Eveniment nou"
        busy={create.isPending}
        className="sm:max-w-2xl"
      >
        <EventForm
          key={attempt}
          options={options}
          actorLevel={actorLevel}
          pending={create.isPending}
          onCancel={() => setOpen(false)}
          onSubmit={async (draft) => {
            const created = await create.mutateAsync(draft);
            setOpen(false);
            // The create receipt sits on the new card, as #849's edit and
            // cancel receipts do (Audit D-11).
            // An OSUBB-wide Event by a writer below BC is a request (spec
            // 2026-10-11): its Announcement, if asked for, follows the approval.
            setEventReceipt(
              created.id,
              created.approval_status === 'pending'
                ? draft.announce
                  ? 'Evenimentul așteaptă aprobarea BC. Anunțul lui va fi publicat odată cu el.'
                  : 'Evenimentul așteaptă aprobarea BC.'
                : draft.announce
                  ? 'Evenimentul și anunțul au fost create.'
                  : 'Evenimentul a fost creat.',
            );
            onCreated?.(created.id);
          }}
        />
      </FormSheet>
    </>
  );
}
