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
import { describeFailure } from '../../lib/command-reasons';
import { safeHttpUrl } from '../../lib/links';
import {
  adherenceFormFieldForReason,
  adherenceFormSchema,
} from '../../lib/schemas/org-settings';
import { useFormValidation } from '../../lib/use-form-validation';
import { useAdminGroups } from '../../queries/groups-admin';
import {
  useOrgSettingChange,
  useOrgSettings,
  type OrgSettingChange,
} from '../../queries/org-settings';

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

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
      boxClassName="space-y-3"
    >
      <p className="m-0 break-all">
        {currentUrl ? (
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            {current}
          </a>
        ) : current ? (
          // Not http(s): shown as text so BC can see and replace it, never as a link.
          <span>{current}</span>
        ) : (
          <span className="text-muted-foreground">Niciun formular setat</span>
        )}
      </p>
      <form onSubmit={submit} noValidate className="grid max-w-xl gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          Adresa formularului
        </label>
        <p id={hintId} className="m-0 text-sm text-muted-foreground">
          Începe cu http:// sau https://. Lasă gol ca să ștergi adresa.
        </p>
        <div className="flex gap-2">
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
          <Button type="submit" className="min-h-11" disabled={disabled}>
            Salvează
          </Button>
        </div>
        <FieldError {...form.errorProps('url')} />
        <FieldError>{form.formError}</FieldError>
        {message && <p role="status">{message}</p>}
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
  /** The Adunarea Generală is a public Group; the board a Private one. */
  privateGroups: boolean;
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
  privateGroups: false,
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
  privateGroups: true,
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
        .filter(
          (group) =>
            group.status === 'active' &&
            group.is_private === setting.privateGroups,
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'ro')),
    [groups.data, setting.privateGroups],
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
      boxClassName="space-y-3"
    >
      <p className="m-0">
        {current === null ? (
          <span className="text-muted-foreground">Niciun grup setat</span>
        ) : (
          <span className="font-semibold">
            {currentGroup?.name ?? `Grupul #${current}`}
          </span>
        )}
      </p>
      {groups.isPending ? (
        <Loading label="Se încarcă grupurile…" />
      ) : groups.isError ? (
        <ErrorState text="Nu am putut încărca grupurile." />
      ) : (
        <form onSubmit={submit} className="grid max-w-xl gap-1.5">
          <label htmlFor={selectId} className="text-sm font-medium">
            {setting.label}
          </label>
          <div className="flex gap-2">
            <select
              id={selectId}
              className={control}
              value={chosen}
              disabled={disabled}
              onChange={(event) => {
                setDraft(event.target.value);
                setMessage(null);
                setError(null);
              }}
            >
              <option value="">
                {current === null ? 'Alege un grup' : 'Niciun grup'}
              </option>
              {current !== null &&
                !choices.some((group) => String(group.id) === current) && (
                  <option value={current}>
                    {currentGroup?.name ?? 'Grupul actual'}
                  </option>
                )}
              {choices.map((group) => (
                <option key={group.id} value={String(group.id)}>
                  {group.name}
                </option>
              ))}
            </select>
            <Button
              type="submit"
              className="min-h-11"
              disabled={disabled || chosen === (current ?? '')}
            >
              Salvează
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
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
    <PageGrid columns={3}>
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
