import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { z } from 'zod';
import { Panel, SubHeading, rowListClass } from '../../../components/layout';
import { ErrorState, Loading } from '../../../components/states';
import { DatePicker } from '../../../components/ui/date-picker';
import { FieldError } from '../../../components/ui/field';
import { InfoHint } from '../../../components/ui/info-hint';
import { Input } from '../../../components/ui/input';
import { bucharestDayKey } from '../../../lib/calendar-time';
import { formatDay, formatPointCount } from '../../../lib/format';
import type { RoleEvaluationKind } from '../../../lib/schemas/role-evaluation';
import {
  cutoffFieldForReason,
  cutoffSchema,
  floorFieldForReason,
  floorSchema,
  pointsStartFieldForReason,
  pointsStartSchema,
} from '../../../lib/schemas/evaluation-settings';
import { useFormValidation } from '../../../lib/use-form-validation';
import {
  useEvaluationSettings,
  type EvaluationSettingCommand,
} from '../../../queries/evaluation-settings';
import {
  useThresholdChanges,
  type PromotionThreshold,
  type RoleEvaluation,
  type ThresholdChange,
} from '../../../queries/role-evaluations';
import { useReceiptTurn } from '../../tracker/receipt-turn';
import {
  ChangeNote,
  EditButton,
  EditorActions,
  PercentRow,
  Receipt,
  SettingRow,
  ThresholdRow,
  useChangeAuthors,
  useEditorFocus,
  type Identities,
  type RunCommand,
} from './shared';

type SettingCommand = (command: EvaluationSettingCommand) => Promise<void>;

/** What differs between the three settings that are one value in a row. */
type ValueEditor<S extends z.ZodType> = {
  label: string;
  /** The "i" beside the name. */
  hint: string;
  /** What the editor says under its field. */
  editorHint: string;
  schema: S;
  /** The field the schema reads, and where a refusal is shown. */
  field: 'floor' | 'date';
  fieldForReason: Readonly<Record<string, string>>;
  /** `a fost salvat` / `a fost salvată`, after the label. */
  saved: string;
  failed: string;
  current: string;
  display: ReactNode;
  save: (values: z.output<S>) => EvaluationSettingCommand;
};

/**
 * One value of the Setări panel — the Prag minim, the Data limită de intrare
 * or the Data de început a punctajului — as a row with its last change and an
 * in-place editor: a pencil, the field, Salvează and Renunță. Salvează checks
 * the value in the browser first; a refusal of the server lands under the
 * field.
 */
function ValueRow<S extends z.ZodType>({
  editor,
  change,
  evaluations,
  identities,
  disabled,
  onSetting,
}: {
  editor: ValueEditor<S>;
  /** The setting's last change in the log, if it has one. */
  change: ThresholdChange | undefined;
  evaluations: readonly RoleEvaluation[];
  identities: Identities;
  disabled: boolean;
  onSetting: SettingCommand;
}) {
  const labelId = useId();
  const inputId = useId();
  const hintId = useId();
  const today = bucharestDayKey(new Date()) ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const editButton = useEditorFocus(editing, inputId);
  // One receipt at a time across the page (F-11).
  const turn = useReceiptTurn();
  const form = useFormValidation(
    editor.schema,
    { [editor.field]: draft } as z.input<S>,
    editor.fieldForReason,
  );
  const isDate = editor.field === 'date';

  function open() {
    setDraft(editor.current);
    setMessage(null);
    form.reset();
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    try {
      await onSetting(editor.save(values));
      setEditing(false);
      setMessage(`${editor.label} ${editor.saved}`);
      turn.claim();
    } catch (failure) {
      form.fail(failure, editor.failed);
    }
  }

  return (
    <SettingRow
      labelId={labelId}
      label={editor.label}
      editing={editing}
      hint={
        !editing && (
          <InfoHint label={`Despre ${editor.label}`}>{editor.hint}</InfoHint>
        )
      }
      value={editor.display}
      controls={
        !editing && (
          <EditButton
            buttonRef={editButton}
            label={editor.label}
            disabled={disabled}
            onClick={open}
          />
        )
      }
    >
      {change && !editing && (
        <ChangeNote
          change={change}
          evaluations={evaluations}
          identities={identities}
        />
      )}
      {editing && (
        // The row's name, right above, is the field's label.
        <form onSubmit={save} noValidate className="grid gap-1.5">
          <div className="flex min-w-0 flex-wrap gap-2">
            {isDate ? (
              <div className="w-56 max-w-full flex-none">
                <DatePicker
                  id={inputId}
                  aria-label={`Valoare nouă pentru ${editor.label}`}
                  value={draft}
                  required
                  max={today}
                  disabled={disabled}
                  onChange={setDraft}
                  {...form.field(editor.field, hintId)}
                />
              </div>
            ) : (
              <Input
                id={inputId}
                aria-label={`Valoare nouă pentru ${editor.label}`}
                inputMode="numeric"
                className="w-32 flex-none"
                value={draft}
                disabled={disabled}
                onChange={(event) => setDraft(event.target.value)}
                {...form.field(editor.field, hintId)}
              />
            )}
            <EditorActions
              disabled={disabled}
              onCancel={() => setEditing(false)}
            />
          </div>
          <p id={hintId} className="m-0 text-sm text-muted-foreground">
            {editor.editorHint}
          </p>
          <FieldError {...form.errorProps(editor.field)} />
          <FieldError>{form.formError}</FieldError>
        </form>
      )}
      <Receipt message={message} current={turn.current} />
    </SettingRow>
  );
}

/** A value or, until BC sets it, "Nesetat". */
const unset = <span className="text-muted-foreground">Nesetat</span>;

const KINDS: readonly RoleEvaluationKind[] = [
  'voluntar_activ',
  'adunarea_generala',
];

/**
 * Setări (R58): the five values a run reads — the Prag minim, the Data
 * limită de intrare, the Data de început a punctajului and the Procent of
 * each kind — each with its last change and an editor, and under
 * **Praguri în vigoare** the two Promotion Thresholds, still hand-editable.
 * Every command decides again on the server (level 6).
 */
export function SettingsPanel({
  thresholds,
  evaluations,
  disabled,
  onRun,
  onSetting,
}: {
  thresholds: readonly PromotionThreshold[];
  evaluations: readonly RoleEvaluation[];
  disabled: boolean;
  onRun: RunCommand;
  onSetting: SettingCommand;
}) {
  const settings = useEvaluationSettings();
  const changes = useThresholdChanges();
  const identities = useChangeAuthors(changes.data);
  const today = bucharestDayKey(new Date()) ?? '';
  const cutoff = useMemo(() => cutoffSchema(today), [today]);
  const pointsStart = useMemo(() => pointsStartSchema(today), [today]);
  // The log is newest first: the first match is the last change.
  const lastChange = (
    field: string,
    kind?: RoleEvaluationKind,
  ): ThresholdChange | undefined =>
    changes.data?.find(
      (change) =>
        change.field === field && (kind === undefined || change.kind === kind),
    );

  return (
    <Panel
      title="Setări"
      control={
        <InfoHint label="Despre setări">
          Valorile după care citește o evaluare: Prag minim, Data limită de
          intrare, Procent, și data de la care se numără punctele în orice
          total. Pragul minim și data limită de intrare se schimbă doar aici,
          iar o evaluare le folosește pe cele în vigoare; procentul din formular
          îl pune în vigoare odată finalizată.
        </InfoHint>
      }
    >
      {settings.isPending ? (
        <Loading label="Se încarcă setările…" />
      ) : settings.isError ? (
        <ErrorState
          text="Nu am putut încărca setările evaluărilor."
          onRetry={() => void settings.refetch()}
        />
      ) : (
        <div className="grid min-w-0 gap-4">
          <ul className={rowListClass}>
            <ValueRow
              editor={{
                label: 'Prag minim',
                hint: 'Punctele de task pe care un membru trebuie să le aibă în perioada evaluată ca să intre în clasament. Sub el, nu se numără la procent.',
                editorHint:
                  'Un număr întreg de cel puțin 1. Se aplică de la următoarea evaluare; evaluările rulate nu se recalculează.',
                schema: floorSchema,
                field: 'floor',
                fieldForReason: floorFieldForReason,
                saved: 'a fost salvat.',
                failed: 'Nu am putut salva pragul minim. Reîncearcă.',
                current:
                  settings.data.eligibilityFloor === null
                    ? ''
                    : String(settings.data.eligibilityFloor),
                display:
                  settings.data.eligibilityFloor === null
                    ? unset
                    : formatPointCount(settings.data.eligibilityFloor),
                save: ({ floor }) => ({ kind: 'floor', points: floor }),
              }}
              change={lastChange('floor')}
              evaluations={evaluations}
              identities={identities}
              disabled={disabled}
              onSetting={onSetting}
            />
            <ValueRow
              editor={{
                label: 'Data limită de intrare',
                hint: 'Doar Voluntarii intrați în OSUBB până la această zi pot deveni candidați la promovare. Se aplică evaluării Voluntar Activ; Adunarea Generală nu are dată limită.',
                editorHint:
                  'O zi, cel târziu azi. Lista candidaților se actualizează îndată ce o schimbi.',
                schema: cutoff,
                field: 'date',
                fieldForReason: cutoffFieldForReason,
                saved: 'a fost salvată.',
                failed: 'Nu am putut salva data limită de intrare. Reîncearcă.',
                current: settings.data.membershipCutoff ?? '',
                display:
                  settings.data.membershipCutoff === null
                    ? unset
                    : formatDay(settings.data.membershipCutoff),
                save: ({ date }) => ({ kind: 'cutoff', date }),
              }}
              change={lastChange('cutoff')}
              evaluations={evaluations}
              identities={identities}
              disabled={disabled}
              onSetting={onSetting}
            />
            <ValueRow
              editor={{
                label: 'Data de început a punctajului',
                hint: 'Punctele de task primite înainte de această zi nu se mai numără în totaluri (punctajul personal, campaniile, Cupa departamentelor); Clasamentul și Tracker membru le arată doar cu un „De la” mai vechi. Evaluările rulate o ignoră, perioada lor fiind aleasă la rulare.',
                editorHint:
                  'O zi, cel târziu azi. Taskurile mai vechi își păstrează punctele și rămân în Taskuri încheiate.',
                schema: pointsStart,
                field: 'date',
                fieldForReason: pointsStartFieldForReason,
                saved: 'a fost salvată.',
                failed:
                  'Nu am putut salva data de început a punctajului. Reîncearcă.',
                current: settings.data.pointsStartDate ?? '',
                display:
                  settings.data.pointsStartDate === null
                    ? unset
                    : formatDay(settings.data.pointsStartDate),
                save: ({ date }) => ({ kind: 'pointsStart', date }),
              }}
              change={lastChange('points_start')}
              evaluations={evaluations}
              identities={identities}
              disabled={disabled}
              onSetting={onSetting}
            />
            {KINDS.map((kind) => (
              <PercentRow
                key={kind}
                kind={kind}
                percent={
                  kind === 'voluntar_activ'
                    ? settings.data.activPercent
                    : settings.data.votPercent
                }
                change={lastChange('percent', kind)}
                evaluations={evaluations}
                identities={identities}
                disabled={disabled}
                onRun={onRun}
              />
            ))}
          </ul>
          <div className="grid min-w-0 gap-2">
            <SubHeading>Praguri în vigoare</SubHeading>
            <ul className={rowListClass}>
              {KINDS.map((kind) => (
                <ThresholdRow
                  key={kind}
                  kind={kind}
                  row={thresholds.find((row) => row.kind === kind)}
                  source={lastChange('threshold', kind)}
                  evaluations={evaluations}
                  identities={identities}
                  disabled={disabled}
                  onRun={onRun}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </Panel>
  );
}
