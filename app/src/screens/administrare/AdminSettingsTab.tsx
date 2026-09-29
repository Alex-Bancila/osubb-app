import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from 'cn';
import {
  focusRingClass,
  PageGrid,
  Panel,
  rowListClass,
  SubHeading,
} from '../../components/layout';
import { ErrorState, Loading } from '../../components/states';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '../../components/ui/native-select';
import { describeFailure } from '../../lib/command-reasons';
import { safeHttpUrl } from '../../lib/links';
import {
  adherenceFormFieldForReason,
  adherenceFormSchema,
} from '../../lib/schemas/org-settings';
import { useFormValidation } from '../../lib/use-form-validation';
import { useAdminGroups, type AdminGroup } from '../../queries/groups-admin';
import {
  useOrgSettingChange,
  useOrgSettings,
  type OrgSettingChange,
} from '../../queries/org-settings';

const control =
  'h-11 w-full min-w-0 rounded-lg border border-border bg-background px-4 text-sm dark:border-input dark:bg-input/30';

type Save = (change: OrgSettingChange) => Promise<void>;
type SettingKey = OrgSettingChange['key'];

/** The receipt every setting shows after a save (#923). */
const SAVED_RECEIPT = 'Setare salvată.';
const SAVE_FAILED = 'Nu am putut salva setarea. Reîncearcă.';

/* ------------------------------------------------------------------------ */
/* The settings, by purpose (#923). Each sentence says what the setting      */
/* really does, checked against the command or migration that reads it.      */
/* ------------------------------------------------------------------------ */

type Setting = {
  key: SettingKey;
  label: string;
  /** What the setting does, in one sentence. */
  effect: string;
  /** What happens while it is unset. */
  unset: string;
};

type GroupSetting = Setting & {
  key: 'adunarea_generala_group_id' | 'board_group_id';
  /** Which active Groups can hold the setting at all (B59). */
  fits: (group: AdminGroup) => boolean;
};

const ADHERENCE_FORM: Setting = {
  key: 'adherence_form_url',
  label: 'Formular de adeziune',
  // `set_member_role` puts the address in the Notification of a Member
  // promoted Voluntar Activ (#681, #826); unset, it says BC sends the form.
  effect:
    'Membrii promovați Voluntar Activ primesc acest link în notificare, ca să completeze adeziunea.',
  unset:
    'Membrii promovați nu primesc niciun link: află doar că formularul vine de la BC.',
};

const ADUNAREA_GENERALA: GroupSetting = {
  key: 'adunarea_generala_group_id',
  label: 'Grupul Adunării Generale',
  // `private.can_read_evaluation_rankings` (#512): the Group's Managers and
  // Responsibles and those of its ancestors; unset, only level 6 and up.
  // Ruling R28: no Periods; Retention Signals stay with level 5 and up (F-14).
  effect:
    'Managerii și responsabilii acestui grup și ai grupurilor de deasupra lui văd clasamentul complet al evaluărilor de rol.',
  unset: 'Doar BC și Moderatorul văd clasamentul complet.',
  // The Adunarea Generală's shape (CONTEXT.md): a public top-level Team with
  // Automatic Membership at Minimum Level 3 — not OSUBB, a Department or a
  // Project.
  fits: (group) =>
    group.category === 'team' &&
    group.parent_id === null &&
    group.automatic_membership &&
    group.min_level === 3 &&
    !group.is_organization &&
    !group.is_private,
};

const BOARD: GroupSetting = {
  key: 'board_group_id',
  label: 'Grupul Biroului de Conducere',
  // #824: only Profil reads it, for BC/BCE's "Funcția în OSUBB", and falls
  // back to the Role label; it confers nothing.
  effect:
    'Titlul fiecărui responsabil din acest grup privat apare pe Profilul lui, la Funcția în OSUBB.',
  unset: 'Profilul membrilor BC și BCE arată rolul, nu un titlu.',
  fits: (group) => group.is_private,
};

/* ------------------------------------------------------------------------ */
/* One setting row: label, effect, the value in force and one edit pattern.  */
/* ------------------------------------------------------------------------ */

type EditorProps = {
  labelId: string;
  disabled: boolean;
  /** Close the editor; `saved` shows the receipt. */
  onDone: (saved: boolean) => void;
};

function SettingRow({
  setting,
  value,
  disabled,
  renderEditor,
}: {
  setting: Setting;
  /** The value in force, read-only; `null` reads "Nesetat". */
  value: ReactNode | null;
  disabled: boolean;
  renderEditor: (props: EditorProps) => ReactNode;
}) {
  const labelId = useId();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  // Back from the editor, focus returns to the button that opened it.
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  return (
    <li
      data-slot="setting-row"
      data-setting={setting.key}
      data-editing={editing || undefined}
      aria-labelledby={labelId}
      className={cn(
        'grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)_auto] sm:items-start',
        editing && 'bg-muted/40',
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <SubHeading as="h3" variant="label" id={labelId}>
          {setting.label}
        </SubHeading>
        <p className="m-0 text-[length:var(--fs-sm)] text-muted-foreground">
          {setting.effect}
        </p>
      </div>
      {/* Phone: the value and its button share a line; from sm, grid cells. */}
      <div className="flex min-w-0 items-start justify-between gap-3 sm:contents">
        <div
          data-slot="setting-value"
          className="flex min-w-0 flex-1 flex-col gap-1"
        >
          <span className="sr-only">Valoare actuală: </span>
          {value === null ? (
            <>
              <span className="inline-flex min-h-7 w-fit items-center rounded-full border border-dashed border-border px-3 text-sm font-semibold text-muted-foreground">
                Nesetat
              </span>
              <p className="m-0 text-[length:var(--fs-sm)] text-muted-foreground">
                {setting.unset}
              </p>
            </>
          ) : (
            <span className="min-w-0 text-sm leading-7 font-medium text-foreground">
              {value}
            </span>
          )}
          {/* Always mounted, so the receipt is announced when it appears. */}
          <p role="status" className="m-0 text-sm font-medium empty:hidden">
            {saved && !editing ? SAVED_RECEIPT : null}
          </p>
        </div>
        {!editing && (
          <Button
            ref={editButton}
            variant="outline"
            aria-label={`Editează ${setting.label}`}
            disabled={disabled}
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            Editează
          </Button>
        )}
      </div>
      {editing && (
        <div className="min-w-0 sm:col-span-full">
          {renderEditor({
            labelId,
            disabled,
            onDone: (didSave) => {
              setSaved(didSave);
              setEditing(false);
            },
          })}
        </div>
      )}
    </li>
  );
}

/** Salvează and Renunță, the same in every editor. */
function EditorActions({
  changed,
  pending,
  onCancel,
}: {
  changed: boolean;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="submit"
        className="flex-1 sm:flex-none"
        disabled={!changed || pending}
      >
        Salvează
      </Button>
      <Button
        type="button"
        variant="outline"
        className="flex-1 sm:flex-none"
        disabled={pending}
        onClick={onCancel}
      >
        Renunță
      </Button>
    </div>
  );
}

/** Focus the editor's control when it opens. */
function useFocusOnOpen() {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('input, select')?.focus();
  }, []);
  return form;
}

/* ------------------------------------------------------------------------ */
/* The adherence form's address                                              */
/* ------------------------------------------------------------------------ */

function AdherenceFormEditor({
  current,
  onSave,
  labelId,
  disabled,
  onDone,
}: EditorProps & { current: string | null; onSave: Save }) {
  const hintId = useId();
  const formRef = useFocusOnOpen();
  const [url, setUrl] = useState(current ?? '');
  const [pending, setPending] = useState(false);
  const form = useFormValidation(
    adherenceFormSchema,
    { url },
    adherenceFormFieldForReason,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    setPending(true);
    try {
      await onSave({ key: 'adherence_form_url', value: values.url });
      onDone(true);
    } catch (failure) {
      form.fail(failure, SAVE_FAILED);
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      aria-labelledby={labelId}
      className="flex max-w-xl flex-col gap-3"
    >
      <input
        type="url"
        inputMode="url"
        aria-labelledby={labelId}
        placeholder="https://"
        className={control}
        value={url}
        disabled={disabled || pending}
        onChange={(event) => setUrl(event.target.value)}
        {...form.field('url', current ? hintId : undefined)}
      />
      {/* How to clear it, only when there is something to clear. */}
      {current && (
        <p id={hintId} className="m-0 text-sm text-muted-foreground">
          Lasă câmpul gol ca să nu mai trimiți niciun link.
        </p>
      )}
      <FieldError {...form.errorProps('url')} />
      <FieldError>{form.formError}</FieldError>
      <EditorActions
        changed={url.trim() !== (current ?? '')}
        pending={pending || disabled}
        onCancel={() => onDone(false)}
      />
    </form>
  );
}

function AdherenceFormValue({ current }: { current: string }) {
  const href = safeHttpUrl(current);
  // A value written outside the server's guard is shown, never linked.
  if (!href)
    return (
      <span className="block truncate" title={current}>
        {current}
      </span>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={current}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-sm underline underline-offset-4',
        focusRingClass,
      )}
    >
      <span className="truncate">
        {current.replace(/^https?:\/\//, '').replace(/\/$/, '')}
      </span>
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only"> (se deschide într-o filă nouă)</span>
    </a>
  );
}

/* ------------------------------------------------------------------------ */
/* A setting that names a Group: the Adunarea Generală (#512) and the board  */
/* (#824, decision D1)                                                       */
/* ------------------------------------------------------------------------ */

function GroupEditor({
  setting,
  current,
  groups,
  onSave,
  labelId,
  disabled,
  onDone,
}: EditorProps & {
  setting: GroupSetting;
  current: string | null;
  groups: AdminGroup[];
  onSave: Save;
}) {
  const formRef = useFocusOnOpen();
  const [chosen, setChosen] = useState(current ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentGroup = groups.find((group) => String(group.id) === current);
  const choices = useMemo(
    () =>
      groups
        .filter((group) => group.status === 'active' && setting.fits(group))
        .sort((a, b) => a.name.localeCompare(b.name, 'ro')),
    [groups, setting],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      // A blank choice clears the setting on the server.
      await onSave({ key: setting.key, value: chosen === '' ? null : chosen });
      onDone(true);
    } catch (failure) {
      setError(describeFailure(failure, SAVE_FAILED).message);
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      aria-labelledby={labelId}
      className="flex max-w-xl flex-col gap-3"
    >
      <NativeSelect
        aria-labelledby={labelId}
        value={chosen}
        disabled={disabled || pending}
        onChange={(event) => {
          setChosen(event.target.value);
          setError(null);
        }}
      >
        <NativeSelectOption value="">
          {current === null ? 'Alege un grup' : 'Niciun grup'}
        </NativeSelectOption>
        {current !== null &&
          !choices.some((group) => String(group.id) === current) && (
            <NativeSelectOption value={current}>
              {currentGroup?.name ?? 'Grupul actual'}
            </NativeSelectOption>
          )}
        {choices.map((group) => (
          <NativeSelectOption key={group.id} value={String(group.id)}>
            {group.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {error && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
      <EditorActions
        changed={chosen !== (current ?? '')}
        pending={pending || disabled}
        onCancel={() => onDone(false)}
      />
    </form>
  );
}

function GroupSettingRow({
  setting,
  current,
  disabled,
  onSave,
}: {
  setting: GroupSetting;
  current: string | null;
  disabled: boolean;
  onSave: Save;
}) {
  const groups = useAdminGroups();
  const currentGroup = groups.data?.find(
    (group) => String(group.id) === current,
  );
  return (
    <SettingRow
      setting={setting}
      value={
        current === null
          ? null
          : groups.isPending
            ? 'Se încarcă…'
            : (currentGroup?.name ?? 'Grup indisponibil')
      }
      disabled={disabled || groups.isPending}
      renderEditor={(props) =>
        groups.isError ? (
          <ErrorState text="Nu am putut încărca grupurile." />
        ) : (
          <GroupEditor
            {...props}
            setting={setting}
            current={current}
            groups={groups.data ?? []}
            onSave={onSave}
          />
        )
      }
    />
  );
}

/**
 * Administrare → Setări (#825, #923): the organization settings BC keeps,
 * grouped by what they are for. Each row names its effect and the value in
 * force ("Nesetat" and what that means when empty); "Editează" opens the same
 * inline editor everywhere — Salvează, enabled once the value changed, and
 * Renunță. Mounted behind `manageRoles`; `set_org_setting` decides again on
 * the server (level 6). The Role Evaluation thresholds and shares are edited
 * in Evaluări de rol (R28, R30), which the first panel links to.
 */
export default function AdminSettingsTab() {
  const settings = useOrgSettings();
  const change = useOrgSettingChange();
  const save: Save = async (next) => {
    await change.mutateAsync(next);
  };

  if (settings.isPending) return <Loading label="Se încarcă setările…" />;
  if (settings.isError)
    return (
      <ErrorState
        text="Nu am putut încărca setările organizației."
        onRetry={() => void settings.refetch()}
      />
    );
  const value = (key: SettingKey) => settings.data.get(key) ?? null;
  const adherence = value('adherence_form_url');
  return (
    <PageGrid columns={1}>
      <Panel
        title="Promovări și evaluări"
        action={{ label: 'Praguri și procente', to: '/administrare/evaluari' }}
        flush
      >
        <ul className={rowListClass}>
          <SettingRow
            setting={ADHERENCE_FORM}
            value={adherence && <AdherenceFormValue current={adherence} />}
            disabled={change.isPending}
            renderEditor={(props) => (
              <AdherenceFormEditor
                {...props}
                current={adherence}
                onSave={save}
              />
            )}
          />
          <GroupSettingRow
            setting={ADUNAREA_GENERALA}
            current={value('adunarea_generala_group_id')}
            disabled={change.isPending}
            onSave={save}
          />
        </ul>
      </Panel>
      <Panel title="Profilul membrilor" flush>
        <ul className={rowListClass}>
          <GroupSettingRow
            setting={BOARD}
            current={value('board_group_id')}
            disabled={change.isPending}
            onSave={save}
          />
        </ul>
      </Panel>
    </PageGrid>
  );
}
