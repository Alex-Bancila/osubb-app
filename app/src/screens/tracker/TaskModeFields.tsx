import { FieldError } from '../../components/ui/field';
import { InfoHint } from '../../components/ui/info-hint';
import { SegmentedRadio } from '../../components/ui/segmented-radio';
import { Select } from '../../components/ui/select';
import type { MinimumLevelOption } from '../../lib/minimum-level';
import type { useFormValidation } from '../../lib/use-form-validation';
import {
  AUDIENCE_HINT,
  AUDIENCE_LABELS,
  PRIVATE_GROUP_AUDIENCE_HINT,
} from './task-form-model';

type Mode = 'direct' | 'public';
type Audience = 'local' | 'org';

/** The slice of `useFormValidation` the two choices register with. */
type Bound = Pick<ReturnType<typeof useFormValidation>, 'field' | 'errorProps'>;

const MODES: { value: Mode; label: string }[] = [
  { value: 'direct', label: 'Direct' },
  { value: 'public', label: 'Public' },
];

const MODES_INFO =
  'Direct: alegi tu executorul, acum sau mai târziu. Public: membrii se înscriu în lista de candidați, iar tu alegi dintre ei.';

/**
 * **Mod de atribuire**, in the create and the edit form: Direct or Public as
 * one segmented choice, what each means behind the "i".
 */
export function AssignmentModeField({
  id,
  value,
  onChange,
  form,
  directLockedBy,
}: {
  /** A `useId()` of the form. */
  id: string;
  value: Mode;
  onChange: (value: Mode) => void;
  form: Bound;
  /**
   * R57: the Role a public Task asks for, when it is above the editor's own.
   * Direct would clear it, which only someone at that Role may do, so the
   * choice is off and the reason stays in view.
   */
  directLockedBy?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-mode`} className="text-sm font-medium">
          Mod de atribuire
        </span>
        <InfoHint label="Despre modul de atribuire" id={`${id}-mode-info`}>
          {MODES_INFO}
        </InfoHint>
      </div>
      <SegmentedRadio
        aria-labelledby={`${id}-mode`}
        options={MODES.map((mode) => ({
          ...mode,
          disabled: mode.value === 'direct' && directLockedBy !== undefined,
        }))}
        value={value}
        onValueChange={onChange}
        {...form.field(
          'assignmentMode',
          directLockedBy
            ? `${id}-mode-info ${id}-mode-locked`
            : `${id}-mode-info`,
        )}
      />
      <FieldError {...form.errorProps('assignmentMode')} />
      {directLockedBy && (
        <p
          id={`${id}-mode-locked`}
          className="m-0 text-sm text-muted-foreground"
        >
          Doar cineva de la {directLockedBy} în sus poate face taskul direct:
          modul direct șterge „Cine îl vede”.
        </p>
      )}
    </div>
  );
}

/**
 * **Audiență**, shown only while the mode is Public (R26). In a Private Group
 * the organization-wide choice is off and the reason stays in view (R25).
 */
export function AudienceField({
  id,
  value,
  localOnly,
  onChange,
  form,
}: {
  /** A `useId()` of the form. */
  id: string;
  value: Audience;
  /** The Group is private: its Tasks are for its members only. */
  localOnly: boolean;
  onChange: (value: Audience) => void;
  form: Bound;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-audience`} className="text-sm font-medium">
          Audiență
        </span>
        <InfoHint label="Despre audiență" id={`${id}-audience-hint`}>
          {AUDIENCE_HINT}
        </InfoHint>
      </div>
      <SegmentedRadio
        aria-labelledby={`${id}-audience`}
        options={[
          { value: 'local', label: AUDIENCE_LABELS.local },
          { value: 'org', label: AUDIENCE_LABELS.org, disabled: localOnly },
        ]}
        value={localOnly ? 'local' : value}
        onValueChange={onChange}
        {...form.field(
          'audience',
          localOnly
            ? `${id}-audience-hint ${id}-audience-private`
            : `${id}-audience-hint`,
        )}
      />
      <FieldError {...form.errorProps('audience')} />
      {localOnly && (
        <p
          id={`${id}-audience-private`}
          className="m-0 text-sm text-muted-foreground"
        >
          {PRIVATE_GROUP_AUDIENCE_HINT}
        </p>
      )}
    </div>
  );
}

/**
 * **Cine îl vede** (R57), under Audiență while the mode is Public: the lowest
 * Role that sees the Task and may join its queue. `locked` names a Role above
 * the editor's own, which only someone at it may change: shown, not offered.
 */
export function MinimumLevelField({
  id,
  value,
  choices,
  locked,
  onChange,
  form,
}: {
  /** A `useId()` of the form. */
  id: string;
  value: number;
  choices: readonly MinimumLevelOption[];
  locked?: string;
  onChange: (value: number) => void;
  form: Bound;
}) {
  if (locked)
    return (
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Cine îl vede</span>
        <p className="m-0 text-sm text-muted-foreground">
          De la {locked}. Doar cineva cu acest rol îl poate schimba.
        </p>
      </div>
    );
  return (
    <div className="grid gap-1.5">
      <label htmlFor={`${id}-min-level`} className="text-sm font-medium">
        Cine îl vede
      </label>
      <Select
        id={`${id}-min-level`}
        name="min_level"
        value={String(value)}
        options={choices.map((choice) => ({
          value: String(choice.level),
          label: choice.label,
        }))}
        onValueChange={(level) => onChange(Number(level))}
        {...form.field('minLevel')}
      />
      <FieldError {...form.errorProps('minLevel')} />
    </div>
  );
}
