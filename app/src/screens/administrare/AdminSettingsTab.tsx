import { useId, useMemo, useState, type FormEvent } from 'react';
import {
  FileSignature,
  Landmark,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { PageGrid, Panel } from '../../components/layout';
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

/* ------------------------------------------------------------------------ */
/* Formular de adeziune                                                      */
/* ------------------------------------------------------------------------ */

function AdherenceFormPanel({
  current,
  disabled,
  onSave,
}: {
  current: string | null;
  disabled: boolean;
  onSave: Save;
}) {
  const inputId = useId();
  const hintId = useId();
  const currentUrl = safeHttpUrl(current);
  const [url, setUrl] = useState(current ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const form = useFormValidation(
    adherenceFormSchema,
    { url },
    adherenceFormFieldForReason,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const values = form.validate();
    if (!values) return;
    try {
      await onSave({ key: 'adherence_form_url', value: values.url });
      setMessage(
        values.url === null
          ? 'Adresa formularului a fost ștearsă.'
          : 'Adresa formularului a fost salvată.',
      );
    } catch (failure) {
      form.fail(failure, 'Nu am putut salva setarea. Reîncearcă.');
    }
  }

  return (
    <Panel
      eyebrow="Roluri"
      icon={FileSignature}
      title="Formular de adeziune"
      description="Linkul pe care îl primește un membru promovat Voluntar Activ."
    >
      {/* The saved address is the field's value: shown once (AD4). */}
      <form onSubmit={submit} noValidate className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          Adresa formularului
        </label>
        <input
          id={inputId}
          type="url"
          inputMode="url"
          className={control}
          value={url}
          disabled={disabled}
          onChange={(event) => setUrl(event.target.value)}
          {...form.field('url', hintId)}
        />
        <p id={hintId} className="m-0 text-sm text-muted-foreground">
          Începe cu http:// sau https://. Lasă gol ca să ștergi adresa.
          {currentUrl && (
            <>
              {' '}
              <a
                href={currentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Deschide formularul salvat
              </a>
            </>
          )}
        </p>
        <FieldError {...form.errorProps('url')} />
        <FieldError>{form.formError}</FieldError>
        <Button type="submit" block className="self-start" disabled={disabled}>
          Salvează
        </Button>
        {message && (
          <p role="status" className="m-0">
            {message}
          </p>
        )}
      </form>
    </Panel>
  );
}

/* ------------------------------------------------------------------------ */
/* A setting that names a Group: the Adunarea Generală (#512) and the board  */
/* (#824, decision D1)                                                       */
/* ------------------------------------------------------------------------ */

type GroupSetting = {
  key: 'adunarea_generala_group_id' | 'board_group_id';
  icon: LucideIcon;
  title: string;
  description: string;
  label: string;
  saved: string;
  cleared: string;
  /** Which active Groups can hold the setting at all (B59). */
  fits: (group: AdminGroup) => boolean;
};

const ADUNAREA_GENERALA: GroupSetting = {
  key: 'adunarea_generala_group_id',
  icon: Landmark,
  title: 'Adunarea Generală',
  description:
    'Managerii și responsabilii acestui grup văd clasamentele complete ale perioadelor și semnalele de retenție.',
  label: 'Grupul Adunării Generale',
  saved: 'Grupul Adunării Generale a fost salvat.',
  cleared: 'Grupul Adunării Generale a fost șters din setări.',
  // The Adunarea Generală's shape: a public top-level Team whose membership
  // follows a Minimum Level automatically — not OSUBB, a Department or a
  // Project, which the list used to offer too.
  fits: (group) =>
    group.category === 'team' &&
    group.parent_id === null &&
    group.automatic_membership &&
    !group.is_organization &&
    !group.is_private,
};

const BOARD: GroupSetting = {
  key: 'board_group_id',
  icon: UsersRound,
  title: 'Biroul de Conducere',
  description:
    'Titlul fiecărui responsabil din acest grup privat apare pe Profil, la Funcția în OSUBB.',
  label: 'Grupul Biroului de Conducere',
  saved: 'Grupul Biroului de Conducere a fost salvat.',
  cleared: 'Grupul Biroului de Conducere a fost șters din setări.',
  fits: (group) => group.is_private,
};

function GroupSettingPanel({
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
  const selectId = useId();
  const groups = useAdminGroups();
  // null = untouched, so an explicit blank choice ("Niciun grup") is not
  // mistaken for "keep the current Group".
  const [draft, setDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentGroup = groups.data?.find(
    (group) => String(group.id) === current,
  );
  const choices = useMemo(
    () =>
      (groups.data ?? [])
        .filter((group) => group.status === 'active' && setting.fits(group))
        .sort((a, b) => a.name.localeCompare(b.name, 'ro')),
    [groups.data, setting],
  );
  const chosen = draft ?? current ?? '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      // A blank choice clears the setting on the server.
      await onSave({ key: setting.key, value: chosen === '' ? null : chosen });
      // The saved value comes back as `current`; a stale draft must not win.
      setDraft(null);
      setMessage(chosen === '' ? setting.cleared : setting.saved);
    } catch (failure) {
      setError(
        describeFailure(failure, 'Nu am putut salva setarea. Reîncearcă.')
          .message,
      );
    }
  }

  return (
    <Panel
      eyebrow="Grupuri"
      icon={setting.icon}
      title={setting.title}
      description={setting.description}
    >
      {groups.isPending ? (
        <Loading label="Se încarcă grupurile…" />
      ) : groups.isError ? (
        <ErrorState text="Nu am putut încărca grupurile." />
      ) : (
        // The Group in force is the select's value: named once (B59).
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor={selectId} className="text-sm font-medium">
            {setting.label}
          </label>
          <NativeSelect
            id={selectId}
            value={chosen}
            disabled={disabled}
            onChange={(event) => {
              setDraft(event.target.value);
              setMessage(null);
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
          <Button
            type="submit"
            block
            className="self-start"
            disabled={disabled || chosen === (current ?? '')}
          >
            Salvează
          </Button>
          {message && (
            <p role="status" className="m-0">
              {message}
            </p>
          )}
        </form>
      )}
    </Panel>
  );
}

/**
 * Administrare → Setări (#825): the organization settings BC keeps — the
 * adherence form a new Voluntar Activ receives, the Group that is the
 * Adunarea Generală (#681, #512) and the Private Group whose Responsibles'
 * titles are the board titles on Profil (#824). Mounted behind `manageRoles`;
 * `set_org_setting` decides again on the server (level 6).
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
  return (
    // One column at reading width: a select or an address needs the room a
    // third of the page never gave it (AD4).
    <PageGrid columns={1} className="max-w-3xl">
      <AdherenceFormPanel
        current={settings.data.get('adherence_form_url') ?? null}
        disabled={change.isPending}
        onSave={save}
      />
      <GroupSettingPanel
        setting={ADUNAREA_GENERALA}
        current={settings.data.get('adunarea_generala_group_id') ?? null}
        disabled={change.isPending}
        onSave={save}
      />
      <GroupSettingPanel
        setting={BOARD}
        current={settings.data.get('board_group_id') ?? null}
        disabled={change.isPending}
        onSave={save}
      />
    </PageGrid>
  );
}
