import { useId, useState, type FormEvent } from 'react';
import { AdherenceMessageDialog } from '../../../components/adherence-message/AdherenceMessage';
import { FormattedTextField } from '../../../components/formatted-text/FormattedTextField';
import { PageGrid, Panel } from '../../../components/layout';
import { ErrorState, Loading } from '../../../components/states';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FieldError } from '../../../components/ui/field';
import { Input } from '../../../components/ui/input';
import { emptyToNull, trimText } from '../../../lib/normalize';
import {
  adherenceMessageFieldForReason,
  adherenceMessageSchema,
} from '../../../lib/schemas/adherence-message';
import { useFormValidation } from '../../../lib/use-form-validation';
import {
  SAVE_MESSAGE_FAILED,
  useAdherenceMessage,
  useAdherenceMessageChange,
  useAdherenceMessageStatus,
  type AdherenceMessage,
  type AdherenceMessageChange,
  type AdherenceMessageStatus,
} from '../../../queries/adherence-message';
import {
  AUDIENCE_LINE,
  countsLine,
  DEFAULT_LINK_LABEL,
  DEFAULT_MESSAGE_TITLE,
  RECEIPT,
  showConsequence,
  STOP_CONSEQUENCE,
} from './message-text';

type Draft = {
  title: string;
  body: string;
  link: { label: string; url: string };
};

function draftOf(message: AdherenceMessage): Draft {
  return {
    title: message.title ?? DEFAULT_MESSAGE_TITLE,
    body: message.body ?? '',
    link: { label: message.linkLabel ?? '', url: message.linkUrl ?? '' },
  };
}

function sameDraft(a: Draft, b: Draft) {
  return (
    a.title === b.title &&
    a.body === b.body &&
    a.link.label === b.link.label &&
    a.link.url === b.link.url
  );
}

/** Whether the draft, as the server would store it, differs from the row. */
function differs(draft: Draft, message: AdherenceMessage) {
  const stored = (value: string) => emptyToNull(trimText(value));
  return (
    stored(draft.title) !== message.title ||
    stored(draft.body) !== message.body ||
    stored(draft.link.label) !== message.linkLabel ||
    stored(draft.link.url) !== message.linkUrl
  );
}

type Confirming = 'publish' | 'again' | 'stop';

const CONFIRM_TITLE: Record<Confirming, string> = {
  publish: 'Publici mesajul?',
  again: 'Arăți mesajul din nou?',
  stop: 'Oprești mesajul?',
};

const CONFIRM_ACTION: Record<Confirming, string> = {
  publish: 'Publică',
  again: 'Salvează și arată din nou',
  stop: 'Oprește mesajul',
};

/**
 * Administrare → Portofoliu Interne → **Mesaj** (ruling R66): the one message
 * every active Voluntar Activ at UBB answers with "Am citit", now and as
 * Members become eligible. BC or the Moderator writes its Titlu, its Mesaj
 * (Formatted Text), and an optional link with the words on its button.
 *
 * With no message, one button publishes it. With one, **Salvează** corrects
 * it quietly (whoever answered keeps it answered and reads the new text on
 * Profil) and **Salvează și arată din nou** gives everyone the pop-up again.
 * Publishing and asking again first say who will see it; **Oprește mesajul**
 * turns it off and keeps the link. **Previzualizează** shows the pop-up as a
 * Member sees it. Mounted behind `manageRoles`; `set_adherence_message`
 * decides again on the server (level 6).
 */
export function MessagePanel() {
  const message = useAdherenceMessage();
  const status = useAdherenceMessageStatus();
  if (message.isPending) return <Loading label="Se încarcă mesajul…" />;
  if (message.isError)
    return (
      <ErrorState
        text="Nu am putut încărca mesajul."
        onRetry={() => void message.refetch()}
      />
    );
  return (
    <PageGrid columns={1}>
      <MessageForm
        message={message.data}
        status={status.data}
        statusFailed={status.isError}
      />
    </PageGrid>
  );
}

function MessageForm({
  message,
  status,
  statusFailed,
}: {
  message: AdherenceMessage;
  status: AdherenceMessageStatus | undefined;
  statusFailed: boolean;
}) {
  const id = useId();
  const change = useAdherenceMessageChange();
  const [draft, setDraft] = useState(() => draftOf(message));
  // A save (here or by someone else) refreshes the row. A draft with nothing
  // unsaved follows it; one being written is kept, and its save wins.
  const [base, setBase] = useState(message);
  if (base !== message) {
    setBase(message);
    if (sameDraft(draft, draftOf(base))) setDraft(draftOf(message));
  }
  // What the confirmation asks, kept while it closes so its words stay put.
  const [asked, setAsked] = useState<Confirming>('publish');
  const [confirming, setConfirming] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const form = useFormValidation(
    adherenceMessageSchema,
    draft,
    adherenceMessageFieldForReason,
  );

  const hasMessage = message.body !== null;
  const changed = differs(draft, message);
  const pending = change.isPending;

  function edit(patch: Partial<Draft>) {
    setReceipt(null);
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function save(next: AdherenceMessageChange, done: string) {
    setReceipt(null);
    try {
      await change.mutateAsync(next);
      setReceipt(done);
    } catch (failure) {
      form.fail(failure, SAVE_MESSAGE_FAILED);
    } finally {
      setConfirming(false);
    }
  }

  function saveDraft(askAgain: boolean, done: string) {
    const values = form.validate();
    if (!values) return;
    void save(
      {
        title: values.title,
        body: values.body,
        linkUrl: values.link.url,
        linkLabel: values.link.label,
        askAgain,
      },
      done,
    );
  }

  /** Publică and "Salvează și arată din nou" ask first, once the draft is valid. */
  function ask(next: Confirming) {
    setReceipt(null);
    if (next !== 'stop' && !form.validate()) return;
    setAsked(next);
    setConfirming(true);
  }

  function confirm() {
    if (asked === 'publish') saveDraft(false, RECEIPT.published);
    else if (asked === 'again') saveDraft(true, RECEIPT.shownAgain);
    else if (asked === 'stop')
      // Off: no heading and no body; the stored link stays.
      void save(
        {
          title: null,
          body: null,
          linkUrl: message.linkUrl,
          linkLabel: message.linkLabel,
          askAgain: false,
        },
        RECEIPT.stopped,
      );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (hasMessage) saveDraft(false, RECEIPT.saved);
    else ask('publish');
  }

  const counts = !hasMessage
    ? null
    : status
      ? countsLine(status.answered, status.eligible)
      : statusFailed
        ? 'Nu am putut încărca numărul confirmărilor.'
        : null;

  return (
    <Panel
      title="Mesajul pentru Voluntarii Activi"
      description={AUDIENCE_LINE}
      stack={4}
    >
      {counts && (
        <p data-slot="message-counts" className="m-0 text-sm font-medium">
          {counts}
        </p>
      )}
      <form
        noValidate
        onSubmit={submit}
        aria-label="Mesajul pentru Voluntarii Activi"
        className="flex max-w-2xl flex-col gap-4"
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
            disabled={pending}
            onChange={(event) => edit({ title: event.target.value })}
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
            Mesaj
          </label>
          <FormattedTextField
            id={`${id}-body`}
            labelId={`${id}-body-label`}
            name="body"
            required
            value={draft.body}
            onChange={(body) => edit({ body })}
            {...form.field('body')}
          />
          <FieldError {...form.errorProps('body')} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-url`} className="text-sm font-medium">
            Link (opțional)
          </label>
          <Input
            id={`${id}-url`}
            name="link_url"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={draft.link.url}
            disabled={pending}
            onChange={(event) => {
              const url = event.target.value;
              // A link typed without words gets the form's usual ones.
              const label =
                draft.link.label === '' &&
                draft.link.url.trim() === '' &&
                url.trim() !== ''
                  ? DEFAULT_LINK_LABEL
                  : draft.link.label;
              edit({ link: { label, url } });
            }}
            {...form.field('link.url')}
          />
          <FieldError {...form.errorProps('link.url')} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-label`} className="text-sm font-medium">
            Textul butonului
          </label>
          <Input
            id={`${id}-label`}
            name="link_label"
            value={draft.link.label}
            disabled={pending}
            onChange={(event) =>
              edit({ link: { ...draft.link, label: event.target.value } })
            }
            {...form.field('link.label')}
          />
          <FieldError {...form.errorProps('link.label')} />
        </div>
        <FieldError>{form.formError}</FieldError>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {hasMessage ? (
            <>
              <Button type="submit" disabled={pending || !changed}>
                Salvează
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => ask('again')}
              >
                Salvează și arată din nou
              </Button>
            </>
          ) : (
            <Button type="submit" disabled={pending}>
              Publică
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setReceipt(null);
              if (form.validate()) setPreviewing(true);
            }}
          >
            Previzualizează
          </Button>
          {hasMessage && (
            <Button
              type="button"
              variant="destructive"
              className="sm:ml-auto"
              disabled={pending}
              onClick={() => ask('stop')}
            >
              Oprește mesajul
            </Button>
          )}
        </div>
      </form>
      {/* Always mounted, so the receipt is announced when it appears. */}
      <p role="status" className="m-0 text-sm font-medium empty:hidden">
        {receipt}
      </p>
      <AdherenceMessageDialog
        message={{
          title: draft.title.trim(),
          body: draft.body.trim(),
          linkUrl: emptyToNull(trimText(draft.link.url)),
          linkLabel: emptyToNull(trimText(draft.link.label)),
        }}
        open={previewing}
        onOpenChange={setPreviewing}
        onAnswer={() => setPreviewing(false)}
      />
      <Dialog
        open={confirming}
        onOpenChange={(open) => !pending && !open && setConfirming(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{CONFIRM_TITLE[asked]}</DialogTitle>
            <DialogDescription>
              {asked === 'stop'
                ? STOP_CONSEQUENCE
                : showConsequence(status?.eligible, asked === 'again')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Renunță
            </Button>
            <Button
              type="button"
              variant={asked === 'stop' ? 'destructive' : 'default'}
              disabled={pending}
              onClick={confirm}
            >
              {CONFIRM_ACTION[asked]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
