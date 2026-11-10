import { Toast } from '../../components/ui/toast';
import { useId, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { FormattedTextField } from '../../components/formatted-text/FormattedTextField';
import { FabAction } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import { DateTimePicker } from '../../components/ui/date-picker';
import { FormSheet, FormSheetFooter } from '../../components/ui/form-sheet';
import { InfoHint } from '../../components/ui/info-hint';
import { Input } from '../../components/ui/input';
import { bucharestWallTimeToIso } from '../../lib/calendar-time';
import { useCapability } from '../../lib/capabilities';
import {
  DEAL_CODE_MAX,
  dealFieldForReason,
  dealSchema,
} from '../../lib/schemas/deal';
import { useFormValidation } from '../../lib/use-form-validation';
import { isAnnouncementRefusal } from '../../queries/announcements';
import {
  useCreateDeal,
  useDealCodeForEdit,
  useUpdateDeal,
} from '../../queries/deals';
import { ErrorState, Loading } from '../../components/states';
import { useGroups } from '../../queries/reference';
import { AttachedLinksFields } from '../../components/attached-link/AttachedLinksFields';
import {
  dealChanges,
  draftFromDeal,
  EMPTY_DEAL_DRAFT,
  type DealDraft,
} from './deal-draft';
import type { DealPresentation } from './deals-presentation';

/**
 * "Deal nou" and "Editează deal-ul" (ruling R45): Titlu, Descriere, an
 * optional Termen, the links and an optional Cod — and nothing else. A Deal
 * is always the Organization's, for every active Member, never critical and
 * never pinned, so the Group, Audience, Nivel, Prioritate and Fixează of an
 * Announcement are not on this form. `deal` given = edit; the caller keys the
 * sheet by its opening so every opening starts from the stored row. The row
 * carries no code (#1152): an edit of a Deal that has one reads it first with
 * `deal_code_for_edit`, which only whoever may edit the Deal gets and which
 * is no reveal.
 */
export default function DealFormSheet({
  deal,
  open,
  onOpenChange,
  onDone,
}: {
  deal?: DealPresentation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const create = useCreateDeal();
  const update = useUpdateDeal();
  const pending = create.isPending || update.isPending;
  const editing = deal !== undefined;
  const needsCode = open && deal?.hasCode === true;
  const storedCode = useDealCodeForEdit(deal?.id ?? 0, needsCode);
  // The form starts from a fresh read of the code and keeps what it started
  // from: a later refresh of that read never replaces a form being filled.
  const [startedFrom, setStartedFrom] = useState<{
    code: string | null;
  } | null>(null);
  if (
    needsCode &&
    startedFrom === null &&
    storedCode.isSuccess &&
    !storedCode.isFetching
  ) {
    setStartedFrom({ code: storedCode.data ?? null });
  }

  const form = (code: string | null) => (
    <DealForm
      deal={deal}
      code={code}
      create={create}
      update={update}
      onCancel={() => onOpenChange(false)}
      onDone={onDone}
    />
  );

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Editează deal-ul' : 'Deal nou'}
      busy={pending}
    >
      {!needsCode ? (
        form(null)
      ) : startedFrom ? (
        form(startedFrom.code)
      ) : storedCode.isError ? (
        <ErrorState
          error={storedCode.error}
          text="Nu am putut deschide codul deal-ului."
          onRetry={() => void storedCode.refetch()}
          retrying={storedCode.isFetching}
        />
      ) : (
        <Loading label="Se încarcă deal-ul…" />
      )}
    </FormSheet>
  );
}

function DealForm({
  deal,
  code,
  create,
  update,
  onCancel,
  onDone,
}: {
  deal?: DealPresentation;
  /** The stored code of the Deal being edited; null for a new one. */
  code: string | null;
  create: ReturnType<typeof useCreateDeal>;
  update: ReturnType<typeof useUpdateDeal>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const groups = useGroups();
  const id = useId();
  const [initial] = useState(() =>
    deal ? draftFromDeal(deal, code) : EMPTY_DEAL_DRAFT,
  );
  const [draft, setDraft] = useState<DealDraft>(initial);
  const deadlineChanged = draft.deadline !== initial.deadline;
  const form = useFormValidation(
    dealSchema,
    {
      title: draft.title,
      body: draft.body,
      // As for an Announcement, a Termen is judged when it is set (R8): an
      // untouched one that has since passed is neither checked nor sent.
      deadline:
        deadlineChanged && draft.deadline
          ? (bucharestWallTimeToIso(draft.deadline) ?? '')
          : null,
      links: draft.links,
      code: draft.code,
    },
    dealFieldForReason,
  );
  const organization = [...(groups.data?.values() ?? [])].find(
    (group) => group.is_organization,
  );
  const pending = create.isPending || update.isPending;
  // A new Deal needs the Organization Group: wait for the Groups to load
  // rather than call a slow read "not found".
  const waitingForGroups = !deal && groups.isPending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    try {
      if (deal) {
        const changes = dealChanges(initial, draft, values);
        if (Object.keys(changes).length === 0) {
          onCancel();
          return;
        }
        await update.mutateAsync({ id: deal.id, changes });
      } else {
        if (!organization) {
          form.fail(
            { message: 'group_not_found' },
            'Nu am găsit grupul OSUBB. Reîncarcă pagina.',
          );
          return;
        }
        await create.mutateAsync({
          organizationGroupId: organization.id,
          title: values.title,
          body: values.body,
          deadline: values.deadline,
          links: values.links,
          code: values.code,
        });
      }
      onDone();
    } catch (cause) {
      form.fail(
        cause,
        isAnnouncementRefusal(cause)
          ? 'Doar echipa OSUBB Deals publică și modifică deal-uri.'
          : deal
            ? 'Deal-ul nu a putut fi salvat. Încearcă din nou.'
            : 'Deal-ul nu a putut fi publicat. Încearcă din nou.',
      );
    }
  }

  const patch = (next: Partial<DealDraft>) =>
    setDraft((current) => ({ ...current, ...next }));

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="flex flex-1 flex-col gap-5"
    >
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-title`} className="text-sm font-medium">
          Titlu
        </label>
        <Input
          id={`${id}-title`}
          name="title"
          required
          value={draft.title}
          onChange={(event) => patch({ title: event.target.value })}
          {...form.field('title')}
        />
        <FieldError {...form.errorProps('title')} />
      </div>
      <div className="grid gap-1.5">
        <label
          id={`${id}-body-label`}
          htmlFor={`${id}-body`}
          className="text-sm font-medium"
        >
          Descriere
        </label>
        <FormattedTextField
          id={`${id}-body`}
          labelId={`${id}-body-label`}
          name="body"
          required
          value={draft.body}
          onChange={(body) => patch({ body })}
          {...form.field('body')}
        />
        <FieldError {...form.errorProps('body')} />
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${id}-deadline`} className="text-sm font-medium">
            Termen (opțional) — ora României
          </label>
          <InfoHint label="Despre termen" id={`${id}-deadline-hint`}>
            După termen, deal-ul dispare pentru membri și rămâne la echipă.
          </InfoHint>
        </div>
        <DateTimePicker
          id={`${id}-deadline`}
          name="deadline"
          defaultTime="23:59"
          value={draft.deadline}
          onChange={(deadline) => patch({ deadline })}
          {...form.field('deadline', `${id}-deadline-hint`)}
        />
        <FieldError {...form.errorProps('deadline')} />
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`${id}-code`} className="text-sm font-medium">
            Cod (opțional)
          </label>
          <InfoHint label="Despre cod" id={`${id}-code-hint`}>
            Membrii îl văd ascuns și îl deschid cu o atingere.
          </InfoHint>
        </div>
        <Input
          id={`${id}-code`}
          className="font-mono tracking-wider"
          name="code"
          autoComplete="off"
          spellCheck={false}
          maxLength={DEAL_CODE_MAX * 2}
          value={draft.code}
          onChange={(event) => patch({ code: event.target.value })}
          {...form.field('code', `${id}-code-hint`)}
        />
        <FieldError {...form.errorProps('code')} />
      </div>
      <AttachedLinksFields
        value={draft.links}
        onChange={(links) => patch({ links })}
        form={form}
        name="links"
      />
      {!deal && (
        // What publishing sets off: read before pressing it.
        <p className="m-0 text-sm text-muted-foreground">
          Pentru toți membrii OSUBB. Fiecare primește o notificare.
        </p>
      )}
      <FieldError>{form.formError}</FieldError>
      <FormSheetFooter>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          Renunță
        </Button>
        <Button type="submit" disabled={pending || waitingForGroups}>
          {deal
            ? update.isPending
              ? 'Se salvează…'
              : 'Salvează modificările'
            : create.isPending
              ? 'Se publică…'
              : 'Publică deal-ul'}
        </Button>
      </FormSheetFooter>
    </form>
  );
}

/**
 * The "Deal nou" button and its sheet, for the OSUBB Deals team and the
 * Moderator (`manage_deals`, R44 amended); nothing for anyone else. Says "Deal-ul a fost publicat."
 * once it is.
 */
export function NewDealControl() {
  const manageDeals = useCapability('manageDeals').data === true;
  const [open, setOpen] = useState(false);
  const [openings, setOpenings] = useState(0);
  const [published, setPublished] = useState(false);
  if (!manageDeals) return null;
  return (
    <div className="space-y-1 empty:hidden">
      <FabAction
        label="Deal nou"
        icon={Plus}
        className="gap-2"
        onSelect={() => {
          setPublished(false);
          setOpenings((count) => count + 1);
          setOpen(true);
        }}
      />
      {published && (
        <Toast onClose={() => setPublished(false)}>
          Deal-ul a fost publicat.
        </Toast>
      )}
      <DealFormSheet
        key={openings}
        open={open}
        onOpenChange={setOpen}
        onDone={() => {
          setOpen(false);
          setPublished(true);
        }}
      />
    </div>
  );
}
