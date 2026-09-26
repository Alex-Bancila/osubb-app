import type { useFormValidation } from '../../lib/use-form-validation';
import { FieldError } from '../ui/field';

const inputClass =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring';
const fieldClass = 'block space-y-1.5 text-sm font-medium text-foreground';

export type AttachedLinkValue = { label: string; url: string };

/** The `field`/`errorProps` slice of `useFormValidation` this pair needs. */
type Bound = Pick<ReturnType<typeof useFormValidation>, 'field' | 'errorProps'>;

type AttachedLinkFieldsProps = {
  value: AttachedLinkValue;
  onChange: (value: AttachedLinkValue) => void;
  /** The caller's `useFormValidation` for the whole draft. */
  form: Bound;
  /**
   * The field path prefix the caller's schema gives this pair — `label` and
   * `url` become `${name}.label` / `${name}.url`. Empty (the default) for a
   * schema where the pair sits at the top, as `attachedLinkSchema` does on
   * its own; `"link"` for `announcementSchema`'s nested `link` field.
   */
  name?: string;
};

/**
 * The one way an Attached Link is entered (CONTEXT.md's glossary, ruling R7):
 * a label and an address, validated as one pair by #674's `attached-link`
 * schema — both or neither, the empty pair valid, the label at most 60
 * characters, the address `http(s)` at most 2048. Errors land under the
 * field they belong to through the caller's `useFormValidation`, exactly as
 * every other form in `app/` shows them (`docs` in `app/README.md`).
 */
export function AttachedLinkFields({
  value,
  onChange,
  form,
  name = '',
}: AttachedLinkFieldsProps) {
  const labelField = name ? `${name}.label` : 'label';
  const urlField = name ? `${name}.url` : 'url';
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className={fieldClass}>
          Etichetă link
          <input
            className={inputClass}
            value={value.label}
            onChange={(event) =>
              onChange({ ...value, label: event.target.value })
            }
            {...form.field(labelField)}
          />
        </label>
        <FieldError {...form.errorProps(labelField)} />
      </div>
      <div className="space-y-1.5">
        <label className={fieldClass}>
          Adresă link
          <input
            className={inputClass}
            type="url"
            placeholder="https://"
            value={value.url}
            onChange={(event) =>
              onChange({ ...value, url: event.target.value })
            }
            {...form.field(urlField)}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Adresa începe cu https://
        </p>
        <FieldError {...form.errorProps(urlField)} />
      </div>
    </div>
  );
}
